import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { disputes } from '../schema.js';
import { appendAuditEvent } from './audit.js';

export type DisputeRow = typeof disputes.$inferSelect;

export interface CreateDisputeInput {
  executionId: string;
  userId: string;
  reason: string;
  description?: string | null;
  mandateId?: string | null;
}

export async function createDispute(
  tx: DbExecutor,
  input: CreateDisputeInput,
): Promise<DisputeRow> {
  const [row] = await tx
    .insert(disputes)
    .values({
      id: randomUUID(),
      executionId: input.executionId,
      userId: input.userId,
      reason: input.reason,
      description: input.description ?? null,
      state: 'OPEN',
    })
    .returning();
  if (!row) throw new Error('dispute insert returned no row');
  await appendAuditEvent(tx, {
    eventType: 'DISPUTE_OPENED',
    actorType: 'HUMAN',
    actorId: input.userId,
    mandateId: input.mandateId ?? null,
    executionId: input.executionId,
    detail: input.reason,
    payload: { disputeId: row.id, reason: input.reason },
  });
  return row;
}

export async function getDispute(db: DbExecutor, id: string): Promise<DisputeRow | undefined> {
  const [row] = await db.select().from(disputes).where(eq(disputes.id, id));
  return row;
}

export async function listDisputesForUser(db: DbExecutor, userId: string): Promise<DisputeRow[]> {
  return db
    .select()
    .from(disputes)
    .where(eq(disputes.userId, userId))
    .orderBy(desc(disputes.createdAt));
}

export async function listDisputesForExecution(
  db: DbExecutor,
  executionId: string,
): Promise<DisputeRow[]> {
  return db
    .select()
    .from(disputes)
    .where(eq(disputes.executionId, executionId))
    .orderBy(desc(disputes.createdAt));
}

export interface ResolveDisputeInput {
  disputeId: string;
  state: 'RESOLVED' | 'ESCALATED';
  resolution: Record<string, unknown>;
  evidenceBundleId: string;
  mandateId?: string | null;
  summary: string;
}

export async function resolveDispute(
  tx: DbExecutor,
  input: ResolveDisputeInput,
): Promise<DisputeRow> {
  const [row] = await tx
    .update(disputes)
    .set({
      state: input.state,
      resolution: input.resolution,
      evidenceBundleId: input.evidenceBundleId,
      resolvedAt: sql`now()`,
    })
    .where(eq(disputes.id, input.disputeId))
    .returning();
  if (!row) throw new Error(`dispute ${input.disputeId} not found`);
  await appendAuditEvent(tx, {
    eventType: 'DISPUTE_RESOLVED',
    actorType: 'SYSTEM',
    mandateId: input.mandateId ?? null,
    executionId: row.executionId,
    detail: input.summary,
    payload: {
      disputeId: row.id,
      state: input.state,
      resolution: input.resolution,
      evidenceBundleId: input.evidenceBundleId,
    },
  });
  return row;
}
