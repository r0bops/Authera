import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PaymentProvider, PaymentState } from '@authera/contracts';
import { paymentMachine, transition } from '@authera/domain';
import { isUniqueViolation, type DbExecutor } from '../client.js';
import { payments, webhookEvents } from '../schema.js';

export type PaymentRow = typeof payments.$inferSelect;
export type WebhookEventRow = typeof webhookEvents.$inferSelect;

export interface CreatePaymentInput {
  executionId: string;
  provider: PaymentProvider;
  amountMinor: number;
  currency: string;
  providerPaymentId?: string | null;
  state?: PaymentState;
}

/** One payment per execution (unique). A repeat returns the existing row. */
export async function createPayment(
  db: DbExecutor,
  input: CreatePaymentInput,
): Promise<PaymentRow> {
  try {
    const [row] = await db
      .insert(payments)
      .values({ id: randomUUID(), ...input, state: input.state ?? 'CREATED' })
      .returning();
    if (!row) throw new Error('payment insert returned no row');
    return row;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await getPaymentByExecution(db, input.executionId);
    if (!existing) throw error;
    return existing;
  }
}

export async function getPaymentByExecution(
  db: DbExecutor,
  executionId: string,
): Promise<PaymentRow | undefined> {
  const [row] = await db.select().from(payments).where(eq(payments.executionId, executionId));
  return row;
}

export async function getPayment(db: DbExecutor, id: string): Promise<PaymentRow | undefined> {
  const [row] = await db.select().from(payments).where(eq(payments.id, id));
  return row;
}

/** Forward-only state change; terminal states are never overwritten (backward events are evidence only). */
export async function transitionPayment(
  db: DbExecutor,
  id: string,
  to: PaymentState,
  patch: {
    providerPaymentId?: string | null;
    providerTransactionId?: string | null;
    lastEventId?: string | null;
    failureReason?: string | null;
  } = {},
): Promise<{ payment: PaymentRow; changed: boolean }> {
  const [current] = await db.select().from(payments).where(eq(payments.id, id)).for('update');
  if (!current) throw new Error(`payment ${id} not found`);
  if (current.state === to) return { payment: current, changed: false };
  transition(paymentMachine, current.state as PaymentState, to);
  const [row] = await db
    .update(payments)
    .set({ ...patch, state: to, updatedAt: sql`now()` })
    .where(eq(payments.id, id))
    .returning();
  if (!row) throw new Error('payment update returned no row');
  return { payment: row, changed: true };
}

export interface RecordWebhookInput {
  provider: PaymentProvider;
  providerEventId: string;
  executionId?: string | null;
  payload: unknown;
}

/** Deduplicate by provider event identity before any state change. */
export async function recordWebhookEvent(
  db: DbExecutor,
  input: RecordWebhookInput,
): Promise<{ event: WebhookEventRow; duplicate: boolean }> {
  try {
    const [row] = await db
      .insert(webhookEvents)
      .values({ id: randomUUID(), ...input, processingState: 'RECEIVED' })
      .returning();
    if (!row) throw new Error('webhook insert returned no row');
    return { event: row, duplicate: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [existing] = await db
      .select()
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, input.provider),
          eq(webhookEvents.providerEventId, input.providerEventId),
        ),
      )
      .orderBy(desc(webhookEvents.createdAt));
    if (!existing) throw error;
    return { event: existing, duplicate: true };
  }
}

export async function markWebhookProcessed(
  db: DbExecutor,
  id: string,
  state: 'PROCESSED' | 'IGNORED' | 'REJECTED',
): Promise<void> {
  await db.update(webhookEvents).set({ processingState: state }).where(eq(webhookEvents.id, id));
}
