import type {
  DisputeView,
  EvidenceBundle,
  EvidenceRole,
  Money,
  PolicyCheck,
  ReasonCode,
} from '@authera/contracts';
import {
  getAgentById,
  getAgentKeyById,
  getBookingByExecution,
  getApprovalRequest,
  getCheckout,
  getExecution,
  getMandate,
  getMandateVersion,
  getOffer,
  getPaymentByExecution,
  getReservationByExecution,
  getUserById,
  listAuditEvents,
  listDisputesForExecution,
  schema,
  verifyAuditChain,
  type Database,
  type DisputeRow,
} from '@authera/db';
import { and, eq } from 'drizzle-orm';
import { describeReason, hashCanonical, type Ed25519PublicJwk } from '@authera/domain';
import type { Clock } from '../clock.js';
import { ApiProblem } from '../http/problem.js';
import { toOfferView } from './checkout-service.js';
import { toPaymentView } from './execution-views.js';
import { verifyMandateJws } from './mandate-signer.js';
import { toBookingView } from './booking-service.js';

export function toDisputeView(row: DisputeRow): DisputeView {
  return {
    id: row.id,
    executionId: row.executionId,
    reason: row.reason as DisputeView['reason'],
    description: row.description,
    state: row.state as DisputeView['state'],
    resolution: (row.resolution as DisputeView['resolution']) ?? null,
    evidenceBundleId: row.evidenceBundleId,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * Evidence bundle builder (spec §15). Everything comes from stored records plus recomputation
 * (cart hash, mandate JWS, audit chain). Role filtering removes what a party should not see;
 * no role ever receives private keys, payment tokens, session secrets, or webhook secrets.
 */
export class EvidenceService {
  constructor(private readonly deps: { db: Database; clock: Clock }) {}

  async bundle(executionId: string, role: EvidenceRole): Promise<EvidenceBundle> {
    const { db, clock } = this.deps;
    const execution = await getExecution(db, executionId);
    if (!execution) throw ApiProblem.notFound('execution');
    const now = clock.now();

    const mandate = execution.mandateId ? await getMandate(db, execution.mandateId) : undefined;
    const version =
      execution.mandateId && execution.mandateVersion
        ? await getMandateVersion(db, execution.mandateId, execution.mandateVersion)
        : undefined;
    const human = mandate ? await getUserById(db, mandate.mandate.userId) : undefined;
    const agent = execution.agentId ? await getAgentById(db, execution.agentId) : undefined;
    const key = execution.agentKeyId ? await getAgentKeyById(db, execution.agentKeyId) : undefined;
    const offer = execution.offerId ? await getOffer(db, execution.offerId) : undefined;
    const checkout = execution.checkoutId ? await getCheckout(db, execution.checkoutId) : undefined;
    const approval = execution.approvalRequestId
      ? await getApprovalRequest(db, execution.approvalRequestId)
      : undefined;
    const consumedApproval =
      !approval && execution.checkoutId ? await this.approvalConsumedBy(executionId) : undefined;
    const reservation = await getReservationByExecution(db, executionId);
    const payment = await getPaymentByExecution(db, executionId);
    const booking = await getBookingByExecution(db, executionId);
    const webhooks = await db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.executionId, executionId));
    const events = await listAuditEvents(db, { executionId, limit: 1000 });
    const chain = await verifyAuditChain(db);
    const disputes = await listDisputesForExecution(db, executionId);

    let signatureVerified = false;
    if (version) {
      const result = await verifyMandateJws(
        version.version.jws,
        async (kid) => {
          const [row] = await db
            .select()
            .from(schema.signingKeys)
            .where(and(eq(schema.signingKeys.kid, kid), eq(schema.signingKeys.status, 'ACTIVE')));
          return row ? (row.publicJwk as unknown as Ed25519PublicJwk) : undefined;
        },
        { now: execution.createdAt, expectedMandateId: version.policy.mandateId },
      );
      signatureVerified = result.ok;
    }

    const amount: Money | null =
      execution.amountMinor !== null && execution.currency
        ? { currency: execution.currency as Money['currency'], minor: execution.amountMinor }
        : null;
    const reasonCode = (execution.reasonCode as ReasonCode | null) ?? null;
    const computedHash = checkout ? hashCanonical(checkout.cart) : '';
    const approvalRow = approval ?? consumedApproval;

    const body: Omit<EvidenceBundle, 'bundleHash'> = {
      schema: 'authera.evidence.v1',
      evidenceId: execution.evidenceId,
      executionId,
      generatedAt: now.toISOString(),
      role,
      execution: {
        state: execution.state as EvidenceBundle['execution']['state'],
        decision: (execution.decision as EvidenceBundle['execution']['decision']) ?? null,
        reasonCode,
        explanation: reasonCode ? describeReason(reasonCode, amount ? { amount } : {}) : null,
        createdAt: execution.createdAt.toISOString(),
        amount,
      },
      human:
        human && mandate && version
          ? {
              id: human.id,
              displayName: role === 'merchant' ? 'Account holder' : human.displayName,
              email: role === 'auditor' ? human.email : null,
              authorization: {
                mandateId: mandate.mandate.id,
                version: version.version.version,
                policyHash: version.version.policyHash,
                signingKid: version.version.signingKid,
                jws: role === 'human' ? null : version.version.jws,
                issuedAt: version.version.createdAt.toISOString(),
              },
            }
          : null,
      mandate:
        mandate && version
          ? {
              policy: version.policy,
              status: mandate.runtime.status as EvidenceBundle['mandate'] extends infer M
                ? M extends { status: infer S }
                  ? S
                  : never
                : never,
              revokedAt: mandate.runtime.revokedAt?.toISOString() ?? null,
              signatureValid: signatureVerified,
              versions: mandate.versions.map((v) => ({
                version: v.version,
                policyHash: v.policyHash,
                createdAt: v.createdAt.toISOString(),
              })),
            }
          : null,
      agent: {
        id: agent?.id ?? null,
        displayName: agent?.displayName ?? null,
        keyThumbprint: key?.thumbprint ?? null,
        profileUri: agent?.profileUri ?? null,
        signatureVerified: execution.state !== 'RECEIVED',
        requestDigest: role === 'human' ? null : execution.requestDigest,
        nonce: role === 'human' ? null : execution.nonce,
        closedCheckout: closedCheckoutFrom(events, role),
      },
      offer: offer ? toOfferView(offer) : null,
      checkout: checkout
        ? {
            id: checkout.id,
            cart: checkout.cart,
            cartHash: checkout.cartHash,
            computedHash,
            bound: checkout.cartHash === computedHash,
            total: checkout.total,
            expiresAt: checkout.expiresAt,
          }
        : null,
      policyChecks: (execution.checklist as PolicyCheck[] | null) ?? [],
      approval: approvalRow
        ? {
            id: approvalRow.id,
            state: approvalRow.state as EvidenceBundle['approval'] extends infer A
              ? A extends { state: infer S }
                ? S
                : never
              : never,
            checkoutHash: approvalRow.checkoutHash,
            decidedAt: approvalRow.decidedAt?.toISOString() ?? null,
          }
        : null,
      reservation: reservation
        ? {
            state: reservation.state,
            amount: {
              currency: (checkout?.total.currency ?? 'USD') as Money['currency'],
              minor: reservation.amountMinor,
            },
            createdAt: reservation.createdAt.toISOString(),
            settledAt: reservation.settledAt?.toISOString() ?? null,
          }
        : null,
      payment: payment ? toPaymentView(payment) : null,
      booking: booking ? toBookingView(booking) : null,
      webhooks: webhooks.map((w) => ({
        provider: w.provider,
        providerEventId: w.providerEventId,
        processingState: w.processingState,
        receivedAt: w.createdAt.toISOString(),
      })),
      audit: {
        events,
        chain: {
          valid: chain.valid,
          events: chain.events,
          reason: chain.reason ?? null,
          brokenAtSequence: chain.brokenAtSequence ?? null,
        },
      },
      disputes: disputes.map(toDisputeView),
    };
    // The bundle hash covers everything above, so an exported file can be checked for tampering.
    return { ...body, bundleHash: hashCanonical(body) };
  }

  /** A CONSUMED approval is linked from the approval side (consumedByExecutionId), not the execution. */
  private async approvalConsumedBy(executionId: string) {
    const [row] = await this.deps.db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.consumedByExecutionId, executionId));
    return row;
  }

  mandateSignatureFacts(bundle: EvidenceBundle): boolean {
    return bundle.human !== null && bundle.mandate !== null;
  }
}

/** The agent-signed closed Checkout Mandate, as recorded by the gateway when it evaluated policy. */
function closedCheckoutFrom(
  events: Array<{ eventType: string; payload: unknown }>,
  role: 'human' | 'merchant' | 'auditor',
): { jws: string | null; kid: string; cartHash: string; verified: boolean } | null {
  const evaluated = events.find((event) => event.eventType === 'POLICY_EVALUATED');
  const payload = evaluated?.payload as
    { closedCheckout?: { jws?: string; kid?: string; cartHash?: string } } | undefined;
  const closed = payload?.closedCheckout;
  if (!closed?.kid || !closed.cartHash) return null;
  return {
    // The human sees that it exists and was verified; digests and tokens stay with merchant/auditor.
    jws: role === 'human' ? null : (closed.jws ?? null),
    kid: closed.kid,
    cartHash: closed.cartHash,
    verified: true,
  };
}
