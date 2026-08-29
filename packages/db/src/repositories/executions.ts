import { desc, eq, sql } from 'drizzle-orm';
import type { Decision, ExecutionState, PolicyCheck, ReasonCode } from '@authera/contracts';
import { executionMachine, transition } from '@authera/domain';
import { isUniqueViolation, type DbExecutor } from '../client.js';
import { executions } from '../schema.js';

export type ExecutionRow = typeof executions.$inferSelect;

export interface CreateExecutionInput {
  id: string;
  evidenceId: string;
  agentId?: string | null;
  agentKeyId?: string | null;
  mandateId?: string | null;
  mandateVersion?: number | null;
  offerId?: string | null;
  checkoutId?: string | null;
  requestDigest?: string | null;
  nonce?: string | null;
}

/** Insert a RECEIVED execution. A repeated id returns the existing row (`created: false`). */
export async function createExecution(
  db: DbExecutor,
  input: CreateExecutionInput,
): Promise<{ execution: ExecutionRow; created: boolean }> {
  try {
    const [row] = await db
      .insert(executions)
      .values({ ...input, state: 'RECEIVED' })
      .returning();
    if (!row) throw new Error('execution insert returned no row');
    return { execution: row, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await getExecution(db, input.id);
    if (!existing) throw error;
    return { execution: existing, created: false };
  }
}

export async function getExecution(db: DbExecutor, id: string): Promise<ExecutionRow | undefined> {
  const [row] = await db.select().from(executions).where(eq(executions.id, id));
  return row;
}

export interface ExecutionPatch {
  mandateId?: string | null;
  mandateVersion?: number | null;
  offerId?: string | null;
  checkoutId?: string | null;
  agentId?: string | null;
  agentKeyId?: string | null;
  decision?: Decision;
  reasonCode?: ReasonCode;
  checklist?: PolicyCheck[];
  amountMinor?: number;
  currency?: string;
  approvalRequestId?: string | null;
}

export async function patchExecution(
  db: DbExecutor,
  id: string,
  patch: ExecutionPatch,
): Promise<ExecutionRow> {
  const [row] = await db
    .update(executions)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(executions.id, id))
    .returning();
  if (!row) throw new Error(`execution ${id} not found`);
  return row;
}

/** Move an execution through a declared transition only; illegal moves throw. */
export async function transitionExecution(
  db: DbExecutor,
  id: string,
  to: ExecutionState,
  patch: ExecutionPatch = {},
): Promise<ExecutionRow> {
  const [current] = await db.select().from(executions).where(eq(executions.id, id)).for('update');
  if (!current) throw new Error(`execution ${id} not found`);
  if (current.state === to) return patchExecution(db, id, patch);
  transition(executionMachine, current.state as ExecutionState, to);
  const [row] = await db
    .update(executions)
    .set({ ...patch, state: to, updatedAt: sql`now()` })
    .where(eq(executions.id, id))
    .returning();
  if (!row) throw new Error(`execution ${id} not found`);
  return row;
}

export async function listExecutions(
  db: DbExecutor,
  filter: { mandateId?: string; limit?: number } = {},
): Promise<ExecutionRow[]> {
  const query = db
    .select()
    .from(executions)
    .orderBy(desc(executions.createdAt))
    .limit(filter.limit ?? 100);
  return filter.mandateId ? query.where(eq(executions.mandateId, filter.mandateId)) : query;
}
