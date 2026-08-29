import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { ExecutionState, PaymentState, ReasonCode } from '@agentcerta/contracts';
import { settleReservation as settleCounters } from '@agentcerta/domain';
import type { Database, DbExecutor } from '../client.js';
import { executions, mandateRuntime, payments, reservations } from '../schema.js';
import { appendAuditEvent } from './audit.js';

export type ReservationRow = typeof reservations.$inferSelect;

export interface ReserveUsageInput {
  executionId: string;
  mandateId: string;
  version: number;
  amountMinor: number;
  /** Server clock used for the validity predicate (demo clock aware). */
  now: Date;
  actorId?: string | null;
}

export type ReserveUsageResult =
  { ok: true; reservation: ReservationRow } | { ok: false; reasonCode: ReasonCode };

/**
 * Atomic usage reservation (spec §10). One conditional UPDATE on the hot `mandate_runtime` row
 * decides the race with revocation and with concurrent attempts: exactly one caller can take
 * the last allowed use. Must run inside the caller's transaction so the reservation, the
 * execution transition, and the audit event commit together.
 */
export async function reserveUsage(
  tx: DbExecutor,
  input: ReserveUsageInput,
): Promise<ReserveUsageResult> {
  const nowIso = input.now.toISOString();
  const updated = await tx.execute(sql`
    UPDATE mandate_runtime
    SET reserved_minor = reserved_minor + ${input.amountMinor},
        reserved_count = reserved_count + 1,
        updated_at = now()
    WHERE mandate_id = ${input.mandateId}
      AND version = ${input.version}
      AND status = 'ACTIVE'
      AND valid_from <= ${nowIso}::timestamptz
      AND valid_until > ${nowIso}::timestamptz
      AND consumed_minor + reserved_minor + ${input.amountMinor} <= max_total_minor
      AND consumed_count + reserved_count + 1 <= max_fulfillments
    RETURNING mandate_id, version
  `);
  if (updated.rowCount !== 1) {
    return { ok: false, reasonCode: await diagnoseReservationFailure(tx, input) };
  }
  const [reservation] = await tx
    .insert(reservations)
    .values({
      id: randomUUID(),
      executionId: input.executionId,
      mandateId: input.mandateId,
      version: input.version,
      amountMinor: input.amountMinor,
      state: 'RESERVED',
    })
    .returning();
  if (!reservation) throw new Error('reservation insert returned no row');
  await tx
    .update(executions)
    .set({ state: 'RESERVED', updatedAt: sql`now()` })
    .where(eq(executions.id, input.executionId));
  await appendAuditEvent(tx, {
    eventType: 'USAGE_RESERVED',
    actorType: 'SYSTEM',
    actorId: input.actorId ?? null,
    mandateId: input.mandateId,
    mandateVersion: input.version,
    executionId: input.executionId,
    payload: { amountMinor: input.amountMinor, reservationId: reservation.id },
  });
  return { ok: true, reservation };
}

async function diagnoseReservationFailure(
  tx: DbExecutor,
  input: ReserveUsageInput,
): Promise<ReasonCode> {
  const [runtime] = await tx
    .select()
    .from(mandateRuntime)
    .where(
      and(eq(mandateRuntime.mandateId, input.mandateId), eq(mandateRuntime.version, input.version)),
    );
  if (!runtime) return 'MANDATE_INVALID';
  switch (runtime.status) {
    case 'REVOKED':
      return 'MANDATE_REVOKED';
    case 'EXPIRED':
      return 'MANDATE_EXPIRED';
    case 'SUPERSEDED':
      return 'MANDATE_SUPERSEDED';
    case 'DRAFT':
      return 'MANDATE_NOT_ACTIVE';
    case 'ACTIVE':
      break;
    default:
      return 'INTERNAL_FAIL_CLOSED';
  }
  if (input.now < runtime.validFrom) return 'MANDATE_NOT_YET_VALID';
  if (input.now >= runtime.validUntil) return 'MANDATE_EXPIRED';
  if (runtime.consumedCount + runtime.reservedCount + 1 > runtime.maxFulfillments)
    return 'USAGE_EXHAUSTED';
  if (runtime.consumedMinor + runtime.reservedMinor + input.amountMinor > runtime.maxTotalMinor)
    return 'AMOUNT_EXCEEDED';
  return 'RESERVATION_CONFLICT';
}

export async function getReservationByExecution(
  db: DbExecutor,
  executionId: string,
): Promise<ReservationRow | undefined> {
  const [row] = await db
    .select()
    .from(reservations)
    .where(eq(reservations.executionId, executionId));
  return row;
}

export interface SettleExecutionInput {
  executionId: string;
  outcome: 'succeeded' | 'failed';
  payment: {
    provider: 'mock' | 'yuno';
    providerPaymentId?: string | null;
    providerTransactionId?: string | null;
    lastEventId?: string | null;
    failureReason?: string | null;
  };
  actorType?: 'SYSTEM' | 'PROVIDER';
  actorId?: string | null;
}

export interface SettleExecutionResult {
  applied: boolean;
  reservationState: string;
  executionState: ExecutionState;
  paymentState: PaymentState;
}

/**
 * Idempotent settlement (spec §10). Locks the reservation; only RESERVED moves counters,
 * payment, execution, and audit — all in one transaction. Any repeat is a no-op.
 */
export async function settleExecution(
  db: Database,
  input: SettleExecutionInput,
): Promise<SettleExecutionResult> {
  return db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(reservations)
      .where(eq(reservations.executionId, input.executionId))
      .for('update');
    if (!reservation) throw new Error(`no reservation for execution ${input.executionId}`);
    const [execution] = await tx
      .select()
      .from(executions)
      .where(eq(executions.id, input.executionId))
      .for('update');
    if (!execution) throw new Error(`execution ${input.executionId} not found`);
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.executionId, input.executionId));

    if (reservation.state !== 'RESERVED') {
      return {
        applied: false,
        reservationState: reservation.state,
        executionState: execution.state as ExecutionState,
        paymentState: (payment?.state ?? 'CREATED') as PaymentState,
      };
    }

    const [runtime] = await tx
      .select()
      .from(mandateRuntime)
      .where(
        and(
          eq(mandateRuntime.mandateId, reservation.mandateId),
          eq(mandateRuntime.version, reservation.version),
        ),
      )
      .for('update');
    if (!runtime) throw new Error('runtime row missing for reservation');

    // The pure domain function validates the counter arithmetic; SQL applies it.
    const settled = settleCounters(
      {
        reservedMinor: runtime.reservedMinor,
        consumedMinor: runtime.consumedMinor,
        reservedCount: runtime.reservedCount,
        consumedCount: runtime.consumedCount,
      },
      { state: 'RESERVED', amountMinor: reservation.amountMinor },
      input.outcome === 'succeeded' ? 'consume' : 'release',
    );
    await tx
      .update(mandateRuntime)
      .set({ ...settled.counters, updatedAt: sql`now()` })
      .where(eq(mandateRuntime.id, runtime.id));
    await tx
      .update(reservations)
      .set({ state: settled.reservation.state, settledAt: sql`now()` })
      .where(eq(reservations.id, reservation.id));

    const paymentState: PaymentState = input.outcome === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
    const paymentValues = {
      provider: input.payment.provider,
      providerPaymentId: input.payment.providerPaymentId ?? null,
      providerTransactionId: input.payment.providerTransactionId ?? null,
      lastEventId: input.payment.lastEventId ?? null,
      failureReason: input.payment.failureReason ?? null,
      state: paymentState,
      updatedAt: sql`now()`,
    };
    let paymentId: string;
    if (payment) {
      await tx.update(payments).set(paymentValues).where(eq(payments.id, payment.id));
      paymentId = payment.id;
    } else {
      paymentId = randomUUID();
      await tx.insert(payments).values({
        id: paymentId,
        executionId: input.executionId,
        amountMinor: reservation.amountMinor,
        currency: runtime.currency,
        ...paymentValues,
      });
    }

    const executionState: ExecutionState = input.outcome === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
    await tx
      .update(executions)
      .set({
        state: executionState,
        reasonCode: input.outcome === 'failed' ? 'PAYMENT_FAILED' : execution.reasonCode,
        updatedAt: sql`now()`,
      })
      .where(eq(executions.id, input.executionId));

    const actorType = input.actorType ?? 'SYSTEM';
    await appendAuditEvent(tx, {
      eventType: input.outcome === 'succeeded' ? 'USAGE_CONSUMED' : 'USAGE_RELEASED',
      actorType,
      actorId: input.actorId ?? null,
      mandateId: reservation.mandateId,
      mandateVersion: reservation.version,
      executionId: input.executionId,
      paymentId,
      payload: { amountMinor: reservation.amountMinor, counters: settled.counters },
    });
    await appendAuditEvent(tx, {
      eventType: input.outcome === 'succeeded' ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
      actorType,
      actorId: input.actorId ?? null,
      mandateId: reservation.mandateId,
      mandateVersion: reservation.version,
      executionId: input.executionId,
      paymentId,
      reasonCode: input.outcome === 'failed' ? 'PAYMENT_FAILED' : null,
      detail: input.outcome === 'failed' ? (input.payment.failureReason ?? undefined) : undefined,
      payload: {
        provider: input.payment.provider,
        providerPaymentId: input.payment.providerPaymentId ?? null,
        providerTransactionId: input.payment.providerTransactionId ?? null,
        eventId: input.payment.lastEventId ?? null,
      },
    });

    return {
      applied: true,
      reservationState: settled.reservation.state,
      executionState,
      paymentState,
    };
  });
}
