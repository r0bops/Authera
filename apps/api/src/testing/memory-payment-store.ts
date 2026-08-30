import type { PaymentEvent, PaymentState } from '@authera/contracts';
import type { AppendAuditEventInput, SettleExecutionResult } from '@authera/db';
import { settleReservation, type RuntimeCounters } from '@authera/domain';
import type { PaymentRecord, PaymentStore } from '../services/payments/payment-store.js';

export interface MemoryExecution {
  state: string;
  reasonCode?: 'PAYMENT_FAILED' | 'BOOKING_FAILED';
  bookingState?: string | null;
  checkoutId: string | null;
  mandateId: string | null;
  mandateVersion: number | null;
  reservation?: { state: 'RESERVED' | 'CONSUMED' | 'RELEASED'; amountMinor: number };
}

/** In-memory PaymentStore mirroring the idempotent settlement semantics of the database. */
export class MemoryPaymentStore implements PaymentStore {
  readonly executions = new Map<string, MemoryExecution>();
  readonly payments = new Map<
    string,
    PaymentRecord & {
      providerTransactionId: string | null;
      failureReason: string | null;
      events: string[];
    }
  >();
  readonly webhooks = new Map<string, { id: string; state: string; event: PaymentEvent }>();
  readonly checkouts = new Map<string, string>();
  readonly events: AppendAuditEventInput[] = [];
  counters: RuntimeCounters = {
    reservedMinor: 0,
    consumedMinor: 0,
    reservedCount: 0,
    consumedCount: 0,
  };

  async requestPayment(
    input: Parameters<PaymentStore['requestPayment']>[0],
  ): Promise<PaymentRecord> {
    const existing = this.payments.get(input.executionId);
    if (existing) return existing;
    const record = {
      id: `pay-${this.payments.size + 1}`,
      executionId: input.executionId,
      provider: input.provider,
      state: 'CREATED' as PaymentState,
      providerPaymentId: null,
      amountMinor: input.amountMinor,
      currency: input.currency,
      providerTransactionId: null,
      failureReason: null,
      events: [] as string[],
    };
    this.payments.set(input.executionId, record);
    this.events.push({
      eventType: 'PAYMENT_REQUESTED',
      actorType: 'SYSTEM',
      executionId: input.executionId,
    });
    return record;
  }

  async getPayment(executionId: string) {
    return this.payments.get(executionId);
  }

  async markPending(input: Parameters<PaymentStore['markPending']>[0]): Promise<void> {
    const payment = this.payments.get(input.executionId);
    if (!payment) throw new Error('payment missing');
    if (payment.state !== 'CREATED') return;
    payment.state = 'PENDING';
    payment.providerPaymentId = input.providerPaymentId;
    const execution = this.executions.get(input.executionId);
    if (execution) execution.state = 'PAYMENT_PENDING';
    this.events.push({
      eventType: 'PAYMENT_PENDING',
      actorType: 'SYSTEM',
      executionId: input.executionId,
    });
  }

  async settle(input: Parameters<PaymentStore['settle']>[0]): Promise<SettleExecutionResult> {
    const execution = this.executions.get(input.executionId);
    const payment = this.payments.get(input.executionId);
    if (!execution?.reservation || !payment) throw new Error('nothing to settle');
    if (execution.reservation.state !== 'RESERVED') {
      return {
        applied: false,
        reservationState: execution.reservation.state,
        executionState: execution.state as SettleExecutionResult['executionState'],
        paymentState: payment.state,
      };
    }
    const settled = settleReservation(
      this.counters,
      execution.reservation,
      input.outcome === 'succeeded' ? 'consume' : 'release',
    );
    this.counters = settled.counters;
    execution.reservation = {
      state: settled.reservation.state as 'CONSUMED' | 'RELEASED',
      amountMinor: settled.reservation.amountMinor,
    };
    execution.state = input.outcome === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
    execution.reasonCode = input.reasonCode;
    payment.state = input.outcome === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
    payment.providerPaymentId = input.providerPaymentId;
    payment.providerTransactionId = input.providerTransactionId;
    payment.failureReason = input.failureReason;
    if (input.eventId) payment.events.push(input.eventId);
    this.events.push({
      eventType: input.outcome === 'succeeded' ? 'USAGE_CONSUMED' : 'USAGE_RELEASED',
      actorType: input.actorType,
      executionId: input.executionId,
    });
    this.events.push({
      eventType: input.outcome === 'succeeded' ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
      actorType: input.actorType,
      executionId: input.executionId,
    });
    if (input.outcome === 'succeeded' && input.checkoutId)
      this.checkouts.set(input.checkoutId, 'COMPLETED');
    return {
      applied: true,
      reservationState: execution.reservation.state,
      executionState: execution.state as SettleExecutionResult['executionState'],
      paymentState: payment.state,
    };
  }

  async recordWebhook(event: PaymentEvent) {
    const key = `${event.provider}:${event.eventId}`;
    const existing = this.webhooks.get(key);
    if (existing) {
      this.events.push({
        eventType: 'WEBHOOK_DUPLICATE',
        actorType: 'PROVIDER',
        executionId: event.executionId,
      });
      return { id: existing.id, duplicate: true };
    }
    const id = `wh-${this.webhooks.size + 1}`;
    this.webhooks.set(key, { id, state: 'RECEIVED', event });
    this.events.push({
      eventType: 'WEBHOOK_RECEIVED',
      actorType: 'PROVIDER',
      executionId: event.executionId,
    });
    return { id, duplicate: false };
  }

  async markWebhook(id: string, state: 'PROCESSED' | 'IGNORED' | 'REJECTED') {
    for (const row of this.webhooks.values()) if (row.id === id) row.state = state;
  }

  async getExecutionContext(executionId: string) {
    const execution = this.executions.get(executionId);
    return execution
      ? {
          checkoutId: execution.checkoutId,
          mandateId: execution.mandateId,
          mandateVersion: execution.mandateVersion,
          state: execution.state,
          bookingState: execution.bookingState ?? null,
        }
      : undefined;
  }

  async audit(event: AppendAuditEventInput) {
    this.events.push(event);
  }

  /** Test helper: an execution with a committed reservation, as the gateway leaves it. */
  reserved(executionId: string, amountMinor: number, checkoutId = 'checkout-1'): void {
    this.executions.set(executionId, {
      state: 'RESERVED',
      checkoutId,
      mandateId: 'mandate-1',
      mandateVersion: 1,
      reservation: { state: 'RESERVED', amountMinor },
    });
    this.counters = {
      ...this.counters,
      reservedMinor: this.counters.reservedMinor + amountMinor,
      reservedCount: this.counters.reservedCount + 1,
    };
  }
}
