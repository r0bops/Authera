import { randomUUID } from 'node:crypto';
import type {
  Decision,
  ExecutionState,
  Money,
  PolicyCheck,
  ReasonCode,
} from '@agentcerta/contracts';
import {
  consumeApproval,
  createApprovalRequest,
  createExecution,
  findActiveApproval,
  getAgentById,
  getCheckout,
  getExecution,
  getMandate,
  getMerchantById,
  getOffer,
  getPaymentByExecution,
  getSigningKeyByKid,
  appendAuditEvent,
  reserveUsage,
  transitionExecution,
  type AppendAuditEventInput,
  type Database,
  type ExecutionRow,
  type MandateAggregate,
  type ReserveUsageResult,
} from '@agentcerta/db';
import type { Checkout, Offer } from '@agentcerta/contracts';
import type { Ed25519PublicJwk } from '@agentcerta/domain';

export interface ExecutionRecord {
  id: string;
  state: ExecutionState;
  decision: Decision | null;
  reasonCode: ReasonCode | null;
  requestDigest: string | null;
  approvalRequestId: string | null;
  paymentId: string | null;
  evidenceId: string;
  amount: Money | null;
}

export interface ExecutionPatchInput {
  mandateId?: string | null;
  mandateVersion?: number | null;
  offerId?: string | null;
  checkoutId?: string | null;
  decision?: Decision;
  reasonCode?: ReasonCode;
  checklist?: PolicyCheck[];
  amountMinor?: number;
  currency?: string;
  approvalRequestId?: string | null;
}

export interface ApprovalRecord {
  id: string;
  checkoutHash: string;
  expiresAt: Date;
  state: string;
}

export interface ReserveInput {
  executionId: string;
  mandateId: string;
  version: number;
  amountMinor: number;
  now: Date;
  approvalId?: string;
  approvedOverLimit?: boolean;
  actorId?: string;
}

export interface CreateApprovalInput {
  executionId: string;
  mandateId: string;
  mandateVersion: number;
  checkoutId: string;
  checkoutHash: string;
  offerId: string;
  reasonCode: ReasonCode;
  amountMinor: number;
  currency: string;
  expiresAt: Date;
  actorId?: string;
}

/**
 * Everything the Mandate Gateway needs from persistence. The gateway never touches SQL, so
 * its decision logic can be exercised against an in-memory store without a database.
 */
export interface GatewayStore {
  getExecution(id: string): Promise<ExecutionRecord | undefined>;
  createExecution(input: {
    id: string;
    evidenceId: string;
    agentId: string;
    agentKeyId: string;
    mandateId: string;
    offerId: string;
    checkoutId: string;
    requestDigest: string;
    nonce: string;
  }): Promise<{ execution: ExecutionRecord; created: boolean }>;
  transitionExecution(
    id: string,
    to: ExecutionState,
    patch?: ExecutionPatchInput,
  ): Promise<ExecutionRecord>;
  loadMandate(mandateId: string): Promise<MandateAggregate | undefined>;
  resolveSigningKey(kid: string): Promise<Ed25519PublicJwk | undefined>;
  getOffer(id: string): Promise<Offer | undefined>;
  getCheckout(id: string): Promise<Checkout | undefined>;
  getMerchant(id: string): Promise<{ id: string; status: string } | undefined>;
  getAgent(id: string): Promise<{ id: string; status: 'ACTIVE' | 'REVOKED' } | undefined>;
  findActiveApproval(input: {
    mandateId: string;
    checkoutHash: string;
    now: Date;
  }): Promise<ApprovalRecord | undefined>;
  /** Atomic: usage reservation (+ approval consumption) or a diagnosed failure. */
  reserve(input: ReserveInput): Promise<ReserveUsageResult>;
  createApprovalRequest(input: CreateApprovalInput): Promise<{ id: string }>;
  audit(event: AppendAuditEventInput): Promise<void>;
}

export function toExecutionRecord(
  row: ExecutionRow,
  paymentId: string | null = null,
): ExecutionRecord {
  return {
    id: row.id,
    paymentId,
    state: row.state as ExecutionState,
    decision: (row.decision as Decision | null) ?? null,
    reasonCode: (row.reasonCode as ReasonCode | null) ?? null,
    requestDigest: row.requestDigest,
    approvalRequestId: row.approvalRequestId,
    evidenceId: row.evidenceId,
    amount:
      row.amountMinor !== null && row.currency
        ? { currency: row.currency as Money['currency'], minor: row.amountMinor }
        : null,
  };
}

export function databaseGatewayStore(db: Database): GatewayStore {
  return {
    async getExecution(id) {
      const row = await getExecution(db, id);
      if (!row) return undefined;
      const payment = await getPaymentByExecution(db, id);
      return toExecutionRecord(row, payment?.id ?? null);
    },
    async createExecution(input) {
      const { execution, created } = await createExecution(db, input);
      return { execution: toExecutionRecord(execution), created };
    },
    async transitionExecution(id, to, patch = {}) {
      return db.transaction(async (tx) =>
        toExecutionRecord(await transitionExecution(tx, id, to, patch)),
      );
    },
    loadMandate: (mandateId) => getMandate(db, mandateId),
    async resolveSigningKey(kid) {
      const key = await getSigningKeyByKid(db, kid);
      return key && key.status === 'ACTIVE'
        ? (key.publicJwk as unknown as Ed25519PublicJwk)
        : undefined;
    },
    getOffer: (id) => getOffer(db, id),
    getCheckout: (id) => getCheckout(db, id),
    async getMerchant(id) {
      const row = await getMerchantById(db, id);
      return row ? { id: row.id, status: row.status } : undefined;
    },
    async getAgent(id) {
      const row = await getAgentById(db, id);
      return row ? { id: row.id, status: row.status as 'ACTIVE' | 'REVOKED' } : undefined;
    },
    async findActiveApproval(input) {
      const row = await findActiveApproval(db, input);
      return row
        ? { id: row.id, checkoutHash: row.checkoutHash, expiresAt: row.expiresAt, state: row.state }
        : undefined;
    },
    reserve(input) {
      return db.transaction(async (tx) => {
        const result = await reserveUsage(tx, input);
        if (result.ok && input.approvalId)
          await consumeApproval(tx, input.approvalId, input.executionId);
        return result;
      });
    },
    createApprovalRequest(input) {
      return db.transaction(async (tx) => {
        const row = await createApprovalRequest(tx, input);
        return { id: row.id };
      });
    },
    async audit(event) {
      await db.transaction((tx) => appendAuditEvent(tx, event));
    },
  };
}

export const newEvidenceId = (executionId: string): string => `ev_${executionId}`;
export const newId = (): string => randomUUID();
