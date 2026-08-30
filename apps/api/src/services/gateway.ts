import {
  PurchaseAttemptRequestSchema,
  type Money,
  type PolicyCheck,
  type PolicyInput,
  type PurchaseAttemptResponse,
  type ReasonCode,
} from '@authera/contracts';
import { evaluatePolicy, hashCanonical } from '@authera/domain';
import type { Clock } from '../clock.js';
import { ApiProblem, formatZodIssues } from '../http/problem.js';
import type { Logger } from '../logger.js';
import type { ExecutionRecord, GatewayStore } from './gateway-store.js';
import { newEvidenceId } from './gateway-store.js';
import { verifyMandateJws } from './mandate-signer.js';

/** The identity facts the signature middleware established. Nothing else from the agent is trusted. */
export interface AgentContext {
  agentId: string;
  agentKeyId: string;
  keyThumbprint: string;
  profileUri: string;
  nonce: string;
  requestDigest: string;
}

export interface ReservedExecution {
  executionId: string;
  mandateId: string;
  mandateVersion: number;
  checkoutId: string;
  offerId: string;
  offerKind: 'flight' | 'goods';
  offerSource: 'demo' | 'duffel' | 'shopify';
  providerOfferId: string | null;
  humanId: string;
  amountMinor: number;
  currency: Money['currency'];
  paymentMethodRef: string;
  evidenceId: string;
}

export interface GatewayDependencies {
  store: GatewayStore;
  clock: Clock;
  logger: Logger;
  /** Runs after a committed reservation. Never called for BLOCK/REQUIRE_HUMAN. */
  onReserved?: (reserved: ReservedExecution) => Promise<Partial<PurchaseAttemptResponse>>;
}

/**
 * The Mandate Gateway (spec §7 purchase sequence). The agent supplied only identifiers; every
 * security-relevant value is loaded here from server-controlled records, evaluated by the pure
 * policy engine, and — only on ALLOW — reserved atomically before any payment call.
 */
export class MandateGateway {
  constructor(private readonly deps: GatewayDependencies) {}

  async attempt(agent: AgentContext, rawBody: unknown): Promise<PurchaseAttemptResponse> {
    const parsed = PurchaseAttemptRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    const request = parsed.data;
    const { store, clock } = this.deps;
    const now = clock.now();

    const { execution: initial, created } = await store.createExecution({
      id: request.executionId,
      evidenceId: newEvidenceId(request.executionId),
      agentId: agent.agentId,
      agentKeyId: agent.agentKeyId,
      mandateId: request.mandateId,
      offerId: request.offerId,
      checkoutId: request.checkoutId,
      requestDigest: agent.requestDigest,
      nonce: agent.nonce,
    });
    if (!created) {
      // Execution ids are idempotency keys: the same request returns the original outcome.
      if (initial.requestDigest !== agent.requestDigest) {
        throw ApiProblem.conflict(
          'EXECUTION_ID_REUSED',
          'This execution id was already used with a different request',
        );
      }
      return this.responseFor(initial);
    }

    await store.transitionExecution(request.executionId, 'AUTHENTICATED');
    const checks: PolicyCheck[] = [];
    const block = (reasonCode: ReasonCode, code: string, detail: unknown) =>
      this.block(
        request.executionId,
        reasonCode,
        [...checks, { code, passed: false, actual: detail }],
        agent,
      );

    // Authoritative records.
    const mandate = await store.loadMandate(request.mandateId);
    if (!mandate) return block('MANDATE_INVALID', 'MANDATE_EXISTS', 'unknown mandate');
    checks.push({ code: 'MANDATE_EXISTS', passed: true });

    const jws = await verifyMandateJws(mandate.version.jws, (kid) => store.resolveSigningKey(kid), {
      now,
      expectedMandateId: mandate.mandate.id,
    });
    if (!jws.ok) {
      const reason: ReasonCode =
        jws.reason === 'expired'
          ? 'MANDATE_EXPIRED'
          : jws.reason === 'not_yet_valid'
            ? 'MANDATE_NOT_YET_VALID'
            : 'MANDATE_INVALID';
      return block(reason, 'MANDATE_SIGNATURE', jws.reason);
    }
    checks.push({
      code: 'MANDATE_SIGNATURE',
      passed: true,
      expected: mandate.version.signingKid,
      actual: jws.kid,
    });
    if (jws.policyHash !== mandate.version.policyHash)
      return block('MANDATE_INVALID', 'MANDATE_HASH', 'stored hash differs from signed policy');
    checks.push({ code: 'MANDATE_HASH', passed: true, expected: mandate.version.policyHash });
    const policy = jws.policy;

    const offer = await store.getOffer(request.offerId);
    if (!offer) return block('OFFER_NOT_AVAILABLE', 'OFFER_EXISTS', 'unknown offer');
    const checkout = await store.getCheckout(request.checkoutId);
    if (!checkout) return block('CHECKOUT_HASH_MISMATCH', 'CHECKOUT_EXISTS', 'unknown checkout');
    if (checkout.status !== 'OPEN')
      return block('CHECKOUT_EXPIRED', 'CHECKOUT_OPEN', checkout.status);
    const merchant = await store.getMerchant(checkout.merchantId);
    if (!merchant || merchant.status !== 'ACTIVE')
      return block('MERCHANT_NOT_ALLOWED', 'MERCHANT_ACTIVE', merchant?.status ?? 'missing');
    const agentRecord = await store.getAgent(agent.agentId);
    const computedHash = hashCanonical(checkout.cart);
    const approval = await store.findActiveApproval({
      mandateId: mandate.mandate.id,
      checkoutHash: checkout.cartHash,
      now,
    });

    const input: PolicyInput = {
      now: now.toISOString(),
      agent: {
        id: agent.agentId,
        keyThumbprint: agent.keyThumbprint,
        status: agentRecord?.status ?? 'REVOKED',
      },
      mandate: policy,
      runtime: {
        status: mandate.runtime.status as PolicyInput['runtime']['status'],
        reservedMinor: mandate.runtime.reservedMinor,
        consumedMinor: mandate.runtime.consumedMinor,
        reservedCount: mandate.runtime.reservedCount,
        consumedCount: mandate.runtime.consumedCount,
      },
      merchant: { id: merchant.id },
      offer: {
        id: offer.id,
        kind: offer.kind,
        merchantId: offer.merchantId,
        ...(offer.origin !== undefined ? { origin: offer.origin } : {}),
        ...(offer.destination !== undefined ? { destination: offer.destination } : {}),
        ...(offer.cabin !== undefined ? { cabin: offer.cabin } : {}),
        ...(offer.departureAt !== undefined ? { departureAt: offer.departureAt } : {}),
        ...(offer.passengerCount !== undefined ? { passengerCount: offer.passengerCount } : {}),
        ...(offer.title !== undefined ? { title: offer.title } : {}),
        quantity: offer.quantity,
        ...(offer.searchQuery !== undefined ? { searchQuery: offer.searchQuery } : {}),
        total: offer.total,
        status: offer.status,
      },
      checkout: {
        id: checkout.id,
        hash: checkout.cartHash,
        computedHash,
        total: checkout.total,
        offerId: checkout.offerId,
        expiresAt: checkout.expiresAt,
      },
      ...(approval
        ? {
            checkoutScopedApproval: {
              checkoutHash: approval.checkoutHash,
              expiresAt: approval.expiresAt.toISOString(),
              status: 'ACTIVE' as const,
            },
          }
        : {}),
    };

    const verdict = evaluatePolicy(input);
    const checklist = [...checks, ...verdict.checks];
    const patch = {
      mandateVersion: mandate.version.version,
      decision: verdict.decision,
      reasonCode: verdict.reasonCode,
      checklist,
      amountMinor: checkout.total.minor,
      currency: checkout.total.currency,
    };
    await store.transitionExecution(request.executionId, 'EVALUATED', patch);
    await store.audit({
      eventType: 'POLICY_EVALUATED',
      actorType: 'SYSTEM',
      actorId: agent.keyThumbprint,
      mandateId: mandate.mandate.id,
      mandateVersion: mandate.version.version,
      executionId: request.executionId,
      checkoutId: checkout.id,
      reasonCode: verdict.reasonCode,
      detail: `${verdict.decision} (${verdict.reasonCode})`,
      payload: {
        decision: verdict.decision,
        reasonCode: verdict.reasonCode,
        amount: checkout.total,
        policyHash: mandate.version.policyHash,
        checkoutHash: checkout.cartHash,
        failedChecks: checklist.filter((c) => !c.passed).map((c) => c.code),
        evaluatedAt: verdict.evaluatedAt,
      },
    });

    if (verdict.decision === 'BLOCK') {
      const record = await store.transitionExecution(request.executionId, 'BLOCKED');
      this.deps.logger.info(
        { executionId: request.executionId, reasonCode: verdict.reasonCode },
        'purchase blocked',
      );
      return this.responseFor(record);
    }

    if (verdict.decision === 'REQUIRE_HUMAN') {
      const approvalRequest = await store.createApprovalRequest({
        executionId: request.executionId,
        mandateId: mandate.mandate.id,
        mandateVersion: mandate.version.version,
        checkoutId: checkout.id,
        checkoutHash: checkout.cartHash,
        offerId: offer.id,
        reasonCode: verdict.reasonCode,
        amountMinor: checkout.total.minor,
        currency: checkout.total.currency,
        expiresAt: new Date(checkout.expiresAt),
        actorId: agent.keyThumbprint,
      });
      const record = await store.transitionExecution(request.executionId, 'REQUIRES_HUMAN', {
        approvalRequestId: approvalRequest.id,
      });
      this.deps.logger.info(
        { executionId: request.executionId, approvalRequestId: approvalRequest.id },
        'purchase paused for human approval',
      );
      return this.responseFor(record);
    }

    // ALLOW: the reservation is the authoritative gate against revocation and concurrency.
    const reservation = await store.reserve({
      executionId: request.executionId,
      mandateId: mandate.mandate.id,
      version: mandate.version.version,
      amountMinor: checkout.total.minor,
      now,
      ...(approval ? { approvalId: approval.id } : {}),
      approvedOverLimit: verdict.reasonCode === 'ALLOW_CHECKOUT_APPROVAL',
      actorId: agent.keyThumbprint,
    });
    if (!reservation.ok) {
      return this.block(
        request.executionId,
        reservation.reasonCode,
        [
          ...checklist,
          { code: 'USAGE_RESERVATION', passed: false, actual: reservation.reasonCode },
        ],
        agent,
      );
    }

    const reserved: ReservedExecution = {
      executionId: request.executionId,
      mandateId: mandate.mandate.id,
      mandateVersion: mandate.version.version,
      checkoutId: checkout.id,
      offerId: offer.id,
      offerKind: offer.kind,
      offerSource: offer.source,
      providerOfferId: offer.providerOfferId ?? null,
      humanId: policy.humanId,
      amountMinor: checkout.total.minor,
      currency: checkout.total.currency,
      paymentMethodRef: policy.paymentMethodRef,
      evidenceId: newEvidenceId(request.executionId),
    };
    this.deps.logger.info(
      { executionId: request.executionId, amountMinor: reserved.amountMinor },
      'usage reserved',
    );
    const afterPayment = this.deps.onReserved ? await this.deps.onReserved(reserved) : {};
    const record = await store.getExecution(request.executionId);
    return { ...this.responseFor(record ?? initial), ...afterPayment };
  }

  private async block(
    executionId: string,
    reasonCode: ReasonCode,
    checklist: PolicyCheck[],
    agent: AgentContext,
  ): Promise<PurchaseAttemptResponse> {
    const record = await this.deps.store.transitionExecution(executionId, 'BLOCKED', {
      decision: 'BLOCK',
      reasonCode,
      checklist,
    });
    await this.deps.store.audit({
      eventType: 'POLICY_EVALUATED',
      actorType: 'SYSTEM',
      actorId: agent.keyThumbprint,
      executionId,
      reasonCode,
      detail: `BLOCK (${reasonCode})`,
      payload: {
        decision: 'BLOCK',
        reasonCode,
        failedChecks: checklist.filter((c) => !c.passed).map((c) => c.code),
      },
    });
    this.deps.logger.info({ executionId, reasonCode }, 'purchase blocked before evaluation');
    return this.responseFor(record);
  }

  responseFor(record: ExecutionRecord): PurchaseAttemptResponse {
    return {
      executionId: record.id,
      decision: record.decision ?? 'BLOCK',
      reasonCode: record.reasonCode ?? 'INTERNAL_FAIL_CLOSED',
      state: record.state,
      ...(record.approvalRequestId ? { approvalRequestId: record.approvalRequestId } : {}),
      ...(record.paymentId ? { paymentId: record.paymentId } : {}),
      evidenceId: record.evidenceId,
    };
  }
}
