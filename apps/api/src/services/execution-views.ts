import type {
  Decision,
  ExecutionState,
  ExecutionView,
  Money,
  PaymentView,
  PolicyCheck,
  ReasonCode,
  VerificationView,
} from '@authera/contracts';
import {
  getAgentById,
  getAgentKeyById,
  getCheckout,
  getExecution,
  getMandateVersion,
  getPaymentByExecution,
  getReservationByExecution,
  listAuditEvents,
  listExecutionsForUser,
  type Database,
  type PaymentRow,
} from '@authera/db';
import { describeReason, hashCanonical } from '@authera/domain';
import type { Clock } from '../clock.js';
import { ApiProblem } from '../http/problem.js';
import { effectiveRuntimeStatus } from './mandate-service.js';

export function toPaymentView(row: PaymentRow): PaymentView {
  return {
    id: row.id,
    provider: row.provider as PaymentView['provider'],
    state: row.state as PaymentView['state'],
    providerPaymentId: row.providerPaymentId,
    providerTransactionId: row.providerTransactionId,
    failureReason: row.failureReason,
    amount: { currency: row.currency as Money['currency'], minor: row.amountMinor },
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Read models for the Agent, Merchant, and Auditor views (spec §12). */
export class ExecutionViews {
  constructor(private readonly deps: { db: Database; clock: Clock }) {}

  async execution(id: string): Promise<ExecutionView> {
    const { db } = this.deps;
    const row = await getExecution(db, id);
    if (!row) throw ApiProblem.notFound('execution');
    const payment = await getPaymentByExecution(db, id);
    const reservation = await getReservationByExecution(db, id);
    const timeline = await listAuditEvents(db, { executionId: id });
    const amount: Money | null =
      row.amountMinor !== null && row.currency
        ? { currency: row.currency as Money['currency'], minor: row.amountMinor }
        : null;
    const limit = await this.limitFor(row.mandateId, row.mandateVersion);
    return {
      id: row.id,
      state: row.state as ExecutionState,
      decision: (row.decision as Decision | null) ?? null,
      reasonCode: (row.reasonCode as ReasonCode | null) ?? null,
      explanation: row.reasonCode
        ? describeReason(row.reasonCode as ReasonCode, {
            ...(amount ? { amount } : {}),
            ...(limit ? { limit } : {}),
          })
        : null,
      mandateId: row.mandateId,
      mandateVersion: row.mandateVersion,
      offerId: row.offerId,
      checkoutId: row.checkoutId,
      agentId: row.agentId,
      amount,
      checklist: (row.checklist as PolicyCheck[] | null) ?? [],
      approvalRequestId: row.approvalRequestId,
      payment: payment ? toPaymentView(payment) : null,
      reservationState: reservation?.state ?? null,
      evidenceId: row.evidenceId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      timeline,
    };
  }

  async verification(executionId: string): Promise<VerificationView> {
    const { db, clock } = this.deps;
    const row = await getExecution(db, executionId);
    if (!row) throw ApiProblem.notFound('execution');
    const agent = row.agentId ? await getAgentById(db, row.agentId) : undefined;
    const key = row.agentKeyId ? await getAgentKeyById(db, row.agentKeyId) : undefined;
    const version =
      row.mandateId && row.mandateVersion
        ? await getMandateVersion(db, row.mandateId, row.mandateVersion)
        : undefined;
    const checkout = row.checkoutId ? await getCheckout(db, row.checkoutId) : undefined;
    const reservation = await getReservationByExecution(db, executionId);
    const payment = await getPaymentByExecution(db, executionId);
    const amount: Money | null =
      row.amountMinor !== null && row.currency
        ? { currency: row.currency as Money['currency'], minor: row.amountMinor }
        : null;
    const limit = await this.limitFor(row.mandateId, row.mandateVersion);
    const computedHash = checkout ? hashCanonical(checkout.cart) : '';
    return {
      executionId: row.id,
      evidenceId: row.evidenceId,
      state: row.state as ExecutionState,
      decision: (row.decision as Decision | null) ?? null,
      reasonCode: (row.reasonCode as ReasonCode | null) ?? null,
      explanation: row.reasonCode
        ? describeReason(row.reasonCode as ReasonCode, {
            ...(amount ? { amount } : {}),
            ...(limit ? { limit } : {}),
          })
        : null,
      agentIdentity: {
        ok: row.state !== 'RECEIVED',
        agentId: agent?.id ?? null,
        keyThumbprint: key?.thumbprint ?? null,
        profileUri: agent?.profileUri ?? null,
        nonce: row.nonce,
        requestDigest: row.requestDigest,
      },
      mandate: version
        ? {
            id: version.policy.mandateId,
            version: version.version.version,
            status: effectiveRuntimeStatus(
              version.runtime.status as VerificationView['mandate'] extends infer M
                ? M extends { status: infer S }
                  ? S
                  : never
                : never,
              version.runtime.validUntil,
              clock.now(),
            ),
            signatureKid: version.version.signingKid,
            policyHash: version.version.policyHash,
            validFrom: version.runtime.validFrom.toISOString(),
            validUntil: version.runtime.validUntil.toISOString(),
          }
        : null,
      policyChecks: (row.checklist as PolicyCheck[] | null) ?? [],
      checkout: checkout
        ? {
            id: checkout.id,
            cartHash: checkout.cartHash,
            computedHash,
            bound: checkout.cartHash === computedHash,
            total: checkout.total,
            status: checkout.status,
          }
        : null,
      reservation: reservation
        ? {
            state: reservation.state,
            amount: {
              currency: (checkout?.total.currency ?? 'USD') as Money['currency'],
              minor: reservation.amountMinor,
            },
          }
        : null,
      payment: payment ? toPaymentView(payment) : null,
    };
  }

  private async limitFor(
    mandateId: string | null,
    version: number | null,
  ): Promise<Money | undefined> {
    if (!mandateId || !version) return undefined;
    const record = await getMandateVersion(this.deps.db, mandateId, version);
    return record
      ? { currency: record.policy.limits.currency, minor: record.policy.limits.maxPerPurchaseMinor }
      : undefined;
  }
}

import type { ExecutionSummary, PurchaseReceipt } from '@authera/contracts';
import { getMandate, getOffer, getPaymentMethodById, listMerchants } from '@authera/db';
import { describeMandatePolicy } from '@authera/domain';
import { offerSummary } from './checkout-service.js';

export async function listExecutionSummaries(
  deps: { db: Database; userId: string },
  filter: { mandateId?: string; limit?: number } = {},
): Promise<ExecutionSummary[]> {
  const rows = await listExecutionsForUser(deps.db, deps.userId, filter);
  const summaries: ExecutionSummary[] = [];
  for (const row of rows) {
    const offer = row.offerId ? await getOffer(deps.db, row.offerId) : undefined;
    const payment = await getPaymentByExecution(deps.db, row.id);
    const amount: Money | null =
      row.amountMinor !== null && row.currency
        ? { currency: row.currency as Money['currency'], minor: row.amountMinor }
        : null;
    const reasonCode = (row.reasonCode as ReasonCode | null) ?? null;
    summaries.push({
      id: row.id,
      state: row.state as ExecutionState,
      decision: (row.decision as Decision | null) ?? null,
      reasonCode,
      explanation: reasonCode ? describeReason(reasonCode, amount ? { amount } : {}) : null,
      mandateId: row.mandateId,
      mandateVersion: row.mandateVersion,
      offerId: row.offerId,
      offerSummary: offer ? offerSummary(offer) : null,
      checkoutId: row.checkoutId,
      amount,
      paymentState: (payment?.state as ExecutionSummary['paymentState']) ?? null,
      approvalRequestId: row.approvalRequestId,
      evidenceId: row.evidenceId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  return summaries;
}

export async function purchaseReceipt(
  deps: { db: Database; clock: Clock; views: ExecutionViews },
  executionId: string,
): Promise<PurchaseReceipt> {
  const execution = await deps.views.execution(executionId);
  const offer = execution.offerId ? await getOffer(deps.db, execution.offerId) : undefined;
  const aggregate = execution.mandateId
    ? await getMandate(deps.db, execution.mandateId)
    : undefined;
  let mandate: PurchaseReceipt['mandate'] = null;
  if (aggregate) {
    const { getAgentById } = await import('@authera/db');
    const agent = await getAgentById(deps.db, aggregate.mandate.agentId);
    const paymentMethod = await getPaymentMethodById(deps.db, aggregate.policy.paymentMethodRef);
    const merchants = (await listMerchants(deps.db)).filter((m) =>
      aggregate.policy.allowedMerchantIds.includes(m.id),
    );
    mandate = {
      id: aggregate.mandate.id,
      version: aggregate.version.version,
      status: effectiveRuntimeStatus(
        aggregate.runtime.status as PurchaseReceipt['mandate'] extends infer M
          ? M extends { status: infer S }
            ? S
            : never
          : never,
        aggregate.runtime.validUntil,
        deps.clock.now(),
      ),
      summary: describeMandatePolicy(aggregate.policy, {
        merchantNames: merchants.map((m) => m.displayName),
        paymentMethodLabel: paymentMethod
          ? `${paymentMethod.displayBrand} ending in ${paymentMethod.displayLast4}`
          : undefined,
      }),
      maxPerPurchase: {
        currency: aggregate.policy.limits.currency,
        minor: aggregate.policy.limits.maxPerPurchaseMinor,
      },
      validUntil: aggregate.policy.validUntil,
      agentDisplayName: agent?.displayName ?? 'Purchasing agent',
      paymentMethodLabel: paymentMethod
        ? `${paymentMethod.displayBrand} •••• ${paymentMethod.displayLast4}`
        : null,
    };
  }
  const checks = execution.checklist;
  const passed = (code: string) => checks.some((c) => c.code === code && c.passed);
  const verification: PurchaseReceipt['verification'] = [
    {
      label: 'Agent identity verified',
      ok: passed('AGENT_BOUND'),
      detail: 'Signed request matched the mandate’s agent key',
    },
    {
      label: 'Mandate signature valid',
      ok: passed('MANDATE_SIGNATURE'),
      detail: 'Trusted-surface signature and policy hash verified',
    },
    {
      label: 'Mandate active at purchase time',
      ok: passed('RUNTIME_ACTIVE') && passed('VALID_UNTIL'),
      detail: null,
    },
    {
      label: 'Amount within authorized limit',
      ok: passed('AMOUNT_PER_PURCHASE') || execution.reasonCode === 'ALLOW_CHECKOUT_APPROVAL',
      detail:
        execution.reasonCode === 'ALLOW_CHECKOUT_APPROVAL'
          ? 'Approved by you for this exact checkout'
          : null,
    },
    {
      label: 'Cart matched the authorized checkout',
      ok: passed('CHECKOUT_INTEGRITY'),
      detail: null,
    },
    {
      label: 'Payment confirmed',
      ok: execution.payment?.state === 'SUCCEEDED',
      detail: execution.payment?.providerPaymentId ?? null,
    },
  ];
  return { execution, offer: offer ? toOfferViewLocal(offer) : null, mandate, verification };
}

function toOfferViewLocal(offer: NonNullable<Awaited<ReturnType<typeof getOffer>>>) {
  return { ...offer, summary: offerSummary(offer) };
}
