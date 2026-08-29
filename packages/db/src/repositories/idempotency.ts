import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { isUniqueViolation, type DbExecutor } from '../client.js';
import { idempotencyRecords } from '../schema.js';

export type IdempotencyBegin =
  | { kind: 'new'; recordId: string }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'mismatch' }
  | { kind: 'in_progress' };

/**
 * Claim an idempotency key. The unique (scope, key) index makes concurrent claims safe:
 * the second caller sees the first one's in-progress or completed record.
 */
export async function beginIdempotent(
  db: DbExecutor,
  input: { scope: string; key: string; requestHash: string },
): Promise<IdempotencyBegin> {
  const recordId = randomUUID();
  try {
    await db.insert(idempotencyRecords).values({ id: recordId, ...input, state: 'IN_PROGRESS' });
    return { kind: 'new', recordId };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  const [existing] = await db
    .select()
    .from(idempotencyRecords)
    .where(and(eq(idempotencyRecords.scope, input.scope), eq(idempotencyRecords.key, input.key)));
  if (!existing) return { kind: 'in_progress' };
  if (existing.requestHash !== input.requestHash) return { kind: 'mismatch' };
  if (existing.state !== 'COMPLETED' || existing.responseStatus === null)
    return { kind: 'in_progress' };
  return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody };
}

export async function completeIdempotent(
  db: DbExecutor,
  recordId: string,
  response: { status: number; body: unknown },
): Promise<void> {
  await db
    .update(idempotencyRecords)
    .set({ state: 'COMPLETED', responseStatus: response.status, responseBody: response.body })
    .where(eq(idempotencyRecords.id, recordId));
}

/** Release a claim after an unexpected failure so a retry can run the handler again. */
export async function abandonIdempotent(db: DbExecutor, recordId: string): Promise<void> {
  await db.delete(idempotencyRecords).where(eq(idempotencyRecords.id, recordId));
}
