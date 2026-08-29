import type {
  Decision,
  ExecutionState,
  ExecutionView,
  Money,
  PaymentView,
  PolicyCheck,
  ReasonCode,
  VerificationView,
} from '@agentcerta/contracts';
import {
  getAgentById,
  getAgentKeyById,
  getCheckout,
  getExecution,
  getMandateVersion,
  getPaymentByExecution,
  getReservationByExecution,
  listAuditEvents,
  type Database,
  type PaymentRow,
} from '@agentcerta/db';
import { describeReason, hashCanonical } from '@agentcerta/domain';
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
