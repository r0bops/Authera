import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type { ActorType, AuditEvent, AuditEventType, ReasonCode } from '@authera/contracts';
import { describeAuditEvent, hashCanonical } from '@authera/domain';
import type { DbExecutor } from '../client.js';
import { auditChainHeads, auditEvents } from '../schema.js';

export const AUDIT_STREAM = 'global';

export interface AppendAuditEventInput {
  eventType: AuditEventType;
  actorType: ActorType;
  actorId?: string | null;
  mandateId?: string | null;
  mandateVersion?: number | null;
  executionId?: string | null;
  checkoutId?: string | null;
  paymentId?: string | null;
  reasonCode?: ReasonCode | null;
  /** Optional detail appended to the templated summary; never LLM-generated. */
  detail?: string;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * Append-only audit chain (spec §10 "Concurrent audit appends"). Must be called inside the
 * business transaction: it locks the chain head row, hashes the event with its predecessor,
 * inserts the next sequence, and advances the head. There is deliberately no update/delete API.
 */
export async function appendAuditEvent(
  tx: DbExecutor,
  input: AppendAuditEventInput,
): Promise<AuditEvent> {
  // The head row is created lazily; the primary key makes concurrent first appends safe.
  await tx.insert(auditChainHeads).values({ stream: AUDIT_STREAM }).onConflictDoNothing();
  const [head] = await tx
    .select()
    .from(auditChainHeads)
    .where(eq(auditChainHeads.stream, AUDIT_STREAM))
    .for('update');
  if (!head) throw new Error('audit chain head missing');

  const sequence = head.lastSequence + 1;
  const occurredAt = input.occurredAt ?? new Date();
  const body = {
    id: randomUUID(),
    sequence,
    eventType: input.eventType,
    occurredAt: occurredAt.toISOString(),
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    mandateId: input.mandateId ?? null,
    mandateVersion: input.mandateVersion ?? null,
    executionId: input.executionId ?? null,
    checkoutId: input.checkoutId ?? null,
    paymentId: input.paymentId ?? null,
    reasonCode: input.reasonCode ?? null,
    summary: describeAuditEvent(input.eventType, input.detail),
    payload: input.payload ?? {},
    previousHash: head.lastHash,
  };
  const hash = hashCanonical(body);

  await tx.insert(auditEvents).values({ ...body, occurredAt, hash });
  await tx
    .update(auditChainHeads)
    .set({ lastSequence: sequence, lastHash: hash, updatedAt: sql`now()` })
    .where(eq(auditChainHeads.stream, AUDIT_STREAM));

  return { ...body, hash };
}

export function toAuditEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    id: row.id,
    sequence: row.sequence,
    eventType: row.eventType as AuditEventType,
    occurredAt: row.occurredAt.toISOString(),
    actorType: row.actorType as ActorType,
    actorId: row.actorId,
    mandateId: row.mandateId,
    mandateVersion: row.mandateVersion,
    executionId: row.executionId,
    checkoutId: row.checkoutId,
    paymentId: row.paymentId,
    reasonCode: row.reasonCode as ReasonCode | null,
    summary: row.summary,
    payload: row.payload,
    previousHash: row.previousHash,
    hash: row.hash,
  };
}

export interface AuditFilter {
  mandateId?: string;
  executionId?: string;
  limit?: number;
}

export async function listAuditEvents(
  db: DbExecutor,
  filter: AuditFilter = {},
): Promise<AuditEvent[]> {
  const conditions = [];
  if (filter.mandateId) conditions.push(eq(auditEvents.mandateId, filter.mandateId));
  if (filter.executionId) conditions.push(eq(auditEvents.executionId, filter.executionId));
  const query = db
    .select()
    .from(auditEvents)
    .orderBy(asc(auditEvents.sequence))
    .limit(filter.limit ?? 500);
  const rows =
    conditions.length > 0 ? await query.where(sql.join(conditions, sql` AND `)) : await query;
  return rows.map(toAuditEvent);
}

export interface ChainVerification {
  valid: boolean;
  events: number;
  brokenAtSequence?: number;
  reason?: string;
}

/** Recompute every hash from the genesis event; tampering or gaps make this fail visibly. */
export async function verifyAuditChain(db: DbExecutor): Promise<ChainVerification> {
  const rows = await db.select().from(auditEvents).orderBy(asc(auditEvents.sequence));
  let previousHash = '';
  let expectedSequence = 1;
  for (const row of rows) {
    if (row.sequence !== expectedSequence) {
      return {
        valid: false,
        events: rows.length,
        brokenAtSequence: row.sequence,
        reason: 'sequence gap',
      };
    }
    if (row.previousHash !== previousHash) {
      return {
        valid: false,
        events: rows.length,
        brokenAtSequence: row.sequence,
        reason: 'previous hash mismatch',
      };
    }
    const event = toAuditEvent(row);
    const { hash, ...body } = event;
    if (hashCanonical(body) !== hash) {
      return {
        valid: false,
        events: rows.length,
        brokenAtSequence: row.sequence,
        reason: 'hash mismatch',
      };
    }
    previousHash = hash;
    expectedSequence += 1;
  }
  const [head] = await db
    .select()
    .from(auditChainHeads)
    .where(eq(auditChainHeads.stream, AUDIT_STREAM));
  if (head && (head.lastSequence !== rows.length || head.lastHash !== previousHash)) {
    return { valid: false, events: rows.length, reason: 'chain head disagrees with events' };
  }
  return { valid: true, events: rows.length };
}
