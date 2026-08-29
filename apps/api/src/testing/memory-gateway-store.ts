import type {
  Checkout,
  ExecutionState,
  MandatePolicyV1,
  Offer,
  ReasonCode,
} from '@agentcerta/contracts';
import type { AppendAuditEventInput, MandateAggregate, ReserveUsageResult } from '@agentcerta/db';
import type { Ed25519PublicJwk } from '@agentcerta/domain';
import { executionMachine, transition } from '@agentcerta/domain';
import type {
  ApprovalRecord,
  ExecutionPatchInput,
  ExecutionRecord,
  GatewayStore,
} from '../services/gateway-store.js';

export interface MemoryMandate {
  policy: MandatePolicyV1;
  jws: string;
  policyHash: string;
  signingKid: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'SUPERSEDED' | 'DRAFT';
  reservedMinor: number;
  consumedMinor: number;
  reservedCount: number;
  consumedCount: number;
}

/**
 * In-memory GatewayStore reproducing the PostgreSQL semantics the gateway relies on
 * (one reservation per execution, conditional reservation predicate, single-use approvals).
 * Lets the gateway's decision logic be tested without a database.
 */
export class MemoryGatewayStore implements GatewayStore {
  readonly executions = new Map<string, ExecutionRecord & { patches: ExecutionPatchInput[] }>();
  readonly mandates = new Map<string, MemoryMandate>();
  readonly offers = new Map<string, Offer>();
  readonly checkouts = new Map<string, Checkout>();
  readonly merchants = new Map<string, { id: string; status: string }>();
  readonly agents = new Map<string, { id: string; status: 'ACTIVE' | 'REVOKED' }>();
  readonly signingKeys = new Map<string, Ed25519PublicJwk>();
  readonly approvals = new Map<
    string,
    ApprovalRecord & { mandateId: string; executionId: string }
  >();
  readonly reservations = new Map<
    string,
    { executionId: string; mandateId: string; amountMinor: number; state: string }
  >();
  readonly events: AppendAuditEventInput[] = [];
  /** Force the next reservation to fail with this code (simulates losing a race). */
  forceReserveFailure: ReasonCode | undefined;

  async getExecution(id: string) {
    return this.executions.get(id);
  }

  async createExecution(input: Parameters<GatewayStore['createExecution']>[0]) {
    const existing = this.executions.get(input.id);
    if (existing) return { execution: existing, created: false };
    const record = {
      id: input.id,
      state: 'RECEIVED' as ExecutionState,
      decision: null,
      reasonCode: null,
      requestDigest: input.requestDigest,
      approvalRequestId: null,
      paymentId: null,
      evidenceId: input.evidenceId,
      amount: null,
      patches: [] as ExecutionPatchInput[],
    };
    this.executions.set(input.id, record);
    return { execution: record, created: true };
  }

  async transitionExecution(id: string, to: ExecutionState, patch: ExecutionPatchInput = {}) {
    const record = this.executions.get(id);
    if (!record) throw new Error(`execution ${id} not found`);
    if (record.state !== to) record.state = transition(executionMachine, record.state, to);
    record.patches.push(patch);
    if (patch.decision) record.decision = patch.decision;
    if (patch.reasonCode) record.reasonCode = patch.reasonCode;
    if (patch.approvalRequestId !== undefined) record.approvalRequestId = patch.approvalRequestId;
    if (patch.amountMinor !== undefined && patch.currency)
      record.amount = { currency: patch.currency as 'USD', minor: patch.amountMinor };
    return record;
  }

  async loadMandate(mandateId: string): Promise<MandateAggregate | undefined> {
    const m = this.mandates.get(mandateId);
    if (!m) return undefined;
    const now = new Date();
    const version = {
      id: `v-${mandateId}`,
      mandateId,
      version: m.policy.version,
      policy: m.policy as unknown as Record<string, unknown>,
      policyHash: m.policyHash,
      jws: m.jws,
      signingKid: m.signingKid,
      createdAt: now,
    };
    return {
      mandate: {
        id: mandateId,
        userId: m.policy.humanId,
        agentId: m.policy.agentId,
        currentVersion: m.policy.version,
        createdAt: now,
      },
      version,
      runtime: {
        id: `rt-${mandateId}`,
        mandateId,
        version: m.policy.version,
        status: m.status,
        validFrom: new Date(m.policy.validFrom),
        validUntil: new Date(m.policy.validUntil),
        currency: m.policy.limits.currency,
        maxPerPurchaseMinor: m.policy.limits.maxPerPurchaseMinor,
        maxTotalMinor: m.policy.limits.maxTotalMinor,
        maxFulfillments: m.policy.limits.maxFulfillments,
        reservedMinor: m.reservedMinor,
        consumedMinor: m.consumedMinor,
        reservedCount: m.reservedCount,
        consumedCount: m.consumedCount,
        revokedAt: null,
        revokeReason: null,
        updatedAt: now,
        createdAt: now,
      },
      policy: m.policy,
      versions: [version],
    };
  }

  async resolveSigningKey(kid: string) {
    return this.signingKeys.get(kid);
  }

  async getOffer(id: string) {
    return this.offers.get(id);
  }

  async getCheckout(id: string) {
    return this.checkouts.get(id);
  }

  async getMerchant(id: string) {
    return this.merchants.get(id);
  }

  async getAgent(id: string) {
    return this.agents.get(id);
  }

  async findActiveApproval(input: { mandateId: string; checkoutHash: string; now: Date }) {
    for (const approval of this.approvals.values()) {
      if (
        approval.mandateId === input.mandateId &&
        approval.checkoutHash === input.checkoutHash &&
        approval.state === 'APPROVED'
      )
        return approval;
    }
    return undefined;
  }

  async reserve(input: Parameters<GatewayStore['reserve']>[0]): Promise<ReserveUsageResult> {
    if (this.forceReserveFailure) {
      const reasonCode = this.forceReserveFailure;
      this.forceReserveFailure = undefined;
      return { ok: false, reasonCode };
    }
    const m = this.mandates.get(input.mandateId);
    if (!m) return { ok: false, reasonCode: 'MANDATE_INVALID' };
    if (m.status !== 'ACTIVE')
      return {
        ok: false,
        reasonCode:
          m.status === 'REVOKED'
            ? 'MANDATE_REVOKED'
            : m.status === 'SUPERSEDED'
              ? 'MANDATE_SUPERSEDED'
              : 'MANDATE_NOT_ACTIVE',
      };
    if (input.now >= new Date(m.policy.validUntil))
      return { ok: false, reasonCode: 'MANDATE_EXPIRED' };
    if (m.consumedCount + m.reservedCount + 1 > m.policy.limits.maxFulfillments)
      return { ok: false, reasonCode: 'USAGE_EXHAUSTED' };
    if (
      !input.approvedOverLimit &&
      m.consumedMinor + m.reservedMinor + input.amountMinor > m.policy.limits.maxTotalMinor
    )
      return { ok: false, reasonCode: 'AMOUNT_EXCEEDED' };
    if (this.reservations.has(input.executionId))
      return { ok: false, reasonCode: 'RESERVATION_CONFLICT' };
    m.reservedMinor += input.amountMinor;
    m.reservedCount += 1;
    const reservation = {
      executionId: input.executionId,
      mandateId: input.mandateId,
      amountMinor: input.amountMinor,
      state: 'RESERVED',
    };
    this.reservations.set(input.executionId, reservation);
    await this.transitionExecution(input.executionId, 'RESERVED');
    if (input.approvalId) {
      const approval = this.approvals.get(input.approvalId);
      if (approval) approval.state = 'CONSUMED';
    }
    this.events.push({
      eventType: 'USAGE_RESERVED',
      actorType: 'SYSTEM',
      executionId: input.executionId,
      mandateId: input.mandateId,
    });
    return {
      ok: true,
      reservation: {
        id: `res-${input.executionId}`,
        executionId: input.executionId,
        mandateId: input.mandateId,
        version: input.version,
        amountMinor: input.amountMinor,
        state: 'RESERVED',
        settledAt: null,
        createdAt: input.now,
      },
    };
  }

  async createApprovalRequest(input: Parameters<GatewayStore['createApprovalRequest']>[0]) {
    const id = `approval-${this.approvals.size + 1}`;
    this.approvals.set(id, {
      id,
      checkoutHash: input.checkoutHash,
      expiresAt: input.expiresAt,
      state: 'PENDING',
      mandateId: input.mandateId,
      executionId: input.executionId,
    });
    this.events.push({
      eventType: 'APPROVAL_REQUESTED',
      actorType: 'SYSTEM',
      executionId: input.executionId,
      mandateId: input.mandateId,
    });
    return { id };
  }

  async audit(event: AppendAuditEventInput) {
    this.events.push(event);
  }
}
