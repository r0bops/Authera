import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ApprovalState, ReasonCode } from '@agentcerta/contracts';
import { approvalMachine, transition } from '@agentcerta/domain';
import type { DbExecutor } from '../client.js';
import { approvalRequests, mandates } from '../schema.js';
import { appendAuditEvent } from './audit.js';

export type ApprovalRow = typeof approvalRequests.$inferSelect;

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
  actorId?: string | null;
}

export async function createApprovalRequest(
  tx: DbExecutor,
  input: CreateApprovalInput,
): Promise<ApprovalRow> {
  const [row] = await tx
    .insert(approvalRequests)
    .values({ id: randomUUID(), ...input, state: 'PENDING' })
    .returning();
  if (!row) throw new Error('approval insert returned no row');
  await appendAuditEvent(tx, {
    eventType: 'APPROVAL_REQUESTED',
    actorType: 'SYSTEM',
    actorId: input.actorId ?? null,
    mandateId: input.mandateId,
    mandateVersion: input.mandateVersion,
    executionId: input.executionId,
    checkoutId: input.checkoutId,
    reasonCode: input.reasonCode,
    payload: {
      approvalRequestId: row.id,
      amountMinor: input.amountMinor,
      currency: input.currency,
      checkoutHash: input.checkoutHash,
    },
  });
  return row;
}

export async function getApprovalRequest(
  db: DbExecutor,
  id: string,
): Promise<ApprovalRow | undefined> {
  const [row] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
  return row;
}

export async function listApprovalsForUser(
  db: DbExecutor,
  userId: string,
  state?: ApprovalState,
): Promise<ApprovalRow[]> {
  const conditions = [eq(mandates.userId, userId)];
  if (state) conditions.push(eq(approvalRequests.state, state));
  const rows = await db
    .select({ approval: approvalRequests })
    .from(approvalRequests)
    .innerJoin(mandates, eq(mandates.id, approvalRequests.mandateId))
    .where(and(...conditions))
    .orderBy(desc(approvalRequests.createdAt));
  return rows.map((r) => r.approval);
}

/** An APPROVED, unexpired approval bound to exactly this checkout hash for this mandate. */
export async function findActiveApproval(
  db: DbExecutor,
  input: { mandateId: string; checkoutHash: string; now: Date },
): Promise<ApprovalRow | undefined> {
  const [row] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.mandateId, input.mandateId),
        eq(approvalRequests.checkoutHash, input.checkoutHash),
        eq(approvalRequests.state, 'APPROVED'),
      ),
    )
    .orderBy(desc(approvalRequests.decidedAt));
  return row;
}

export interface DecideApprovalInput {
  approvalId: string;
  decision: 'APPROVED' | 'REJECTED';
  actorId: string;
  evidence: Record<string, unknown>;
}

/** Single terminal human decision, bound to the stored checkout hash. Idempotent per decision. */
export async function decideApproval(
  tx: DbExecutor,
  input: DecideApprovalInput,
): Promise<ApprovalRow> {
  const [current] = await tx
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, input.approvalId))
    .for('update');
  if (!current) throw new Error(`approval ${input.approvalId} not found`);
  if (current.state === input.decision) return current;
  transition(approvalMachine, current.state as ApprovalState, input.decision);
  const [row] = await tx
    .update(approvalRequests)
    .set({ state: input.decision, decidedAt: sql`now()`, decisionEvidence: input.evidence })
    .where(eq(approvalRequests.id, input.approvalId))
    .returning();
  if (!row) throw new Error('approval update returned no row');
  await appendAuditEvent(tx, {
    eventType: input.decision === 'APPROVED' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
    actorType: 'HUMAN',
    actorId: input.actorId,
    mandateId: row.mandateId,
    mandateVersion: row.mandateVersion,
    executionId: row.executionId,
    checkoutId: row.checkoutId,
    reasonCode: row.reasonCode as ReasonCode,
    detail: `checkout ${row.checkoutHash.slice(0, 23)}…`,
    payload: {
      approvalRequestId: row.id,
      checkoutHash: row.checkoutHash,
      amountMinor: row.amountMinor,
      evidence: input.evidence,
    },
  });
  return row;
}

export async function consumeApproval(
  tx: DbExecutor,
  approvalId: string,
  executionId: string,
): Promise<ApprovalRow> {
  const [current] = await tx
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, approvalId))
    .for('update');
  if (!current) throw new Error(`approval ${approvalId} not found`);
  if (current.state === 'CONSUMED' && current.consumedByExecutionId === executionId) return current;
  transition(approvalMachine, current.state as ApprovalState, 'CONSUMED');
  const [row] = await tx
    .update(approvalRequests)
    .set({ state: 'CONSUMED', consumedByExecutionId: executionId })
    .where(eq(approvalRequests.id, approvalId))
    .returning();
  if (!row) throw new Error('approval update returned no row');
  return row;
}

export async function expireApproval(tx: DbExecutor, approvalId: string): Promise<void> {
  await tx
    .update(approvalRequests)
    .set({ state: 'EXPIRED', decidedAt: sql`now()` })
    .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.state, 'PENDING')));
}
