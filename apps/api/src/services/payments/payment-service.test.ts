import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../clock.js';
import { createLogger } from '../../logger.js';
import { MemoryPaymentStore } from '../../testing/memory-payment-store.js';
import type { ReservedExecution } from '../gateway.js';
import { MockPaymentProcessor } from './mock-processor.js';
import { PaymentService } from './payment-service.js';

const clock = fixedClock('2026-08-30T12:00:00.000Z');
const logger = createLogger({ level: 'silent' });
const EXECUTION = '4c0f2c2e-2b2e-4b6c-8a5e-7c8c1e6b9a11';

function reserved(): ReservedExecution {
  return {
    executionId: EXECUTION,
    mandateId: 'mandate-1',
    mandateVersion: 1,
    checkoutId: 'checkout-1',
    offerId: 'offer-1',
    offerKind: 'flight',
    offerSource: 'demo',
    providerOfferId: null,
    humanId: 'human-1',
    amountMinor: 13_000,
    currency: 'USD',
    paymentMethodRef: 'pm_ref',
    evidenceId: `ev_${EXECUTION}`,
  };
}

describe('PaymentService', () => {
  let store: MemoryPaymentStore;
  let processor: MockPaymentProcessor;
  let service: PaymentService;

  beforeEach(() => {
    store = new MemoryPaymentStore();
    processor = new MockPaymentProcessor(clock);
    service = new PaymentService({ store, processor, clock, logger });
    processor.onWebhook((event) => service.handleWebhook(event));
    store.reserved(EXECUTION, 13_000);
  });

  it('success consumes the reservation exactly once and completes the checkout', async () => {
    const first = await service.executeReserved(reserved());
    expect(first).toMatchObject({ state: 'SUCCEEDED', paymentId: 'pay-1' });
    expect(store.counters).toEqual({
      reservedMinor: 0,
      consumedMinor: 13_000,
      reservedCount: 0,
      consumedCount: 1,
    });
    expect(store.checkouts.get('checkout-1')).toBe('COMPLETED');
    const again = await service.executeReserved(reserved());
    expect(again).toMatchObject({ state: 'SUCCEEDED', paymentId: 'pay-1' });
    expect(processor.calls).toHaveLength(1);
    expect(store.counters.consumedCount).toBe(1);
    expect(store.events.map((e) => e.eventType)).toEqual([
      'PAYMENT_REQUESTED',
      'PAYMENT_PENDING',
      'USAGE_CONSUMED',
      'PAYMENT_SUCCEEDED',
    ]);
    expect(processor.captureCalls).toEqual([
      {
        executionId: EXECUTION,
        providerPaymentId: processor.resultFor(EXECUTION)?.providerPaymentId,
      },
    ]);
  });

  it('failure releases the reservation once and reports PAYMENT_FAILED', async () => {
    processor.setBehavior(EXECUTION, { outcome: 'fail', failureReason: 'card_declined' });
    const result = await service.executeReserved(reserved());
    expect(result).toMatchObject({ state: 'FAILED', reasonCode: 'PAYMENT_FAILED' });
    expect(store.counters).toEqual({
      reservedMinor: 0,
      consumedMinor: 0,
      reservedCount: 0,
      consumedCount: 0,
    });
    expect(store.payments.get(EXECUTION)).toMatchObject({
      state: 'FAILED',
      failureReason: 'card_declined',
    });
    expect(store.checkouts.has('checkout-1')).toBe(false);
  });

  it('pending resolves through the webhook; duplicate webhooks are recorded but applied once', async () => {
    vi.useFakeTimers();
    try {
      processor.setBehavior(EXECUTION, {
        outcome: 'pending',
        webhookDelayMs: 100,
        pendingResolvesTo: 'succeed',
        duplicateWebhooks: 1,
      });
      const result = await service.executeReserved(reserved());
      expect(result).toMatchObject({ state: 'PAYMENT_PENDING' });
      expect(store.executions.get(EXECUTION)?.state).toBe('PAYMENT_PENDING');
      expect(store.counters.reservedCount).toBe(1);
      await vi.advanceTimersByTimeAsync(200);
      expect(store.executions.get(EXECUTION)?.state).toBe('SUCCEEDED');
      expect(store.counters).toEqual({
        reservedMinor: 0,
        consumedMinor: 13_000,
        reservedCount: 0,
        consumedCount: 1,
      });
      const types = store.events.map((e) => e.eventType);
      expect(types.filter((t) => t === 'WEBHOOK_RECEIVED')).toHaveLength(1);
      expect(types.filter((t) => t === 'WEBHOOK_DUPLICATE')).toHaveLength(1);
      expect(types.filter((t) => t === 'USAGE_CONSUMED')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a contradicting event after a terminal state is retained as evidence but ignored', async () => {
    await service.executeReserved(reserved());
    const outcome = await service.handleWebhook(
      processor.buildEvent({
        executionId: EXECUTION,
        amount: { currency: 'USD', minor: 13_000 },
        type: 'PAYMENT_FAILED',
        eventId: 'late-failure',
      }),
    );
    expect(outcome).toBe('ignored');
    expect(store.payments.get(EXECUTION)?.state).toBe('SUCCEEDED');
    expect(
      [...store.webhooks.values()].find((w) => w.event.eventId === 'late-failure')?.state,
    ).toBe('IGNORED');
    expect(
      await service.handleWebhook(
        processor.buildEvent({
          executionId: 'unknown-exec',
          amount: { currency: 'USD', minor: 1 },
          type: 'PAYMENT_SUCCEEDED',
        }),
      ),
    ).toBe('unknown_execution');
  });

  it('rejects a webhook that does not match the stored payment', async () => {
    processor.setBehavior(EXECUTION, { outcome: 'pending' });
    await service.executeReserved(reserved());

    const outcome = await service.handleWebhook(
      processor.buildEvent({
        executionId: EXECUTION,
        amount: { currency: 'USD', minor: 1 },
        type: 'PAYMENT_SUCCEEDED',
        eventId: 'wrong-amount',
      }),
    );

    expect(outcome).toBe('ignored');
    expect(store.executions.get(EXECUTION)?.state).toBe('PAYMENT_PENDING');
    expect(store.counters.reservedCount).toBe(1);
    expect(
      [...store.webhooks.values()].find((row) => row.event.eventId === 'wrong-amount')?.state,
    ).toBe('REJECTED');
  });

  it('preserves BOOKING_FAILED if Stripe cancellation wins the settlement race', async () => {
    processor.setBehavior(EXECUTION, { outcome: 'pending' });
    await service.executeReserved(reserved());
    const execution = store.executions.get(EXECUTION)!;
    execution.bookingState = 'FAILED';

    await expect(
      service.handleWebhook(
        processor.buildEvent({
          executionId: EXECUTION,
          amount: { currency: 'USD', minor: 13_000 },
          type: 'PAYMENT_FAILED',
          eventId: 'stripe-canceled-after-booking-failure',
        }),
      ),
    ).resolves.toBe('processed');
    expect(execution).toMatchObject({ state: 'FAILED', reasonCode: 'BOOKING_FAILED' });
    expect(store.payments.get(EXECUTION)).toMatchObject({
      failureReason: 'booking_failed_authorization_canceled',
    });
  });

  it('a provider outage leaves a recoverable PAYMENT_PENDING, never a guessed success', async () => {
    const failing = {
      provider: 'mock' as const,
      createCheckoutSession: processor.createCheckoutSession.bind(processor),
      parseWebhook: processor.parseWebhook.bind(processor),
      purchase: async () => {
        throw new Error('timeout');
      },
      capture: processor.capture.bind(processor),
      cancel: processor.cancel.bind(processor),
    };
    const broken = new PaymentService({ store, processor: failing, clock, logger });
    const result = await broken.executeReserved(reserved());
    expect(result).toMatchObject({ state: 'PAYMENT_PENDING' });
    expect(store.counters.reservedCount).toBe(1);
    expect(store.counters.consumedCount).toBe(0);
  });

  it('books a Duffel flight between authorization and capture', async () => {
    const live = { ...reserved(), offerSource: 'duffel' as const, providerOfferId: 'off_test' };
    const fulfill = vi.fn(async () => ({ state: 'BOOKED' as const, bookingId: 'booking-1' }));
    service = new PaymentService({ store, processor, clock, logger, fulfill });

    await expect(service.executeReserved(live)).resolves.toMatchObject({ state: 'SUCCEEDED' });
    expect(fulfill).toHaveBeenCalledWith(live, processor.resultFor(EXECUTION)?.providerPaymentId);
    expect(processor.captureCalls).toHaveLength(1);
    expect(processor.cancelCalls).toHaveLength(0);
  });

  it('cancels the authorization and releases usage after a definitive booking failure', async () => {
    const fulfill = vi.fn(async () => ({
      state: 'FAILED' as const,
      bookingId: 'booking-1',
      failureReason: 'duffel_422',
    }));
    service = new PaymentService({ store, processor, clock, logger, fulfill });

    await expect(service.executeReserved(reserved())).resolves.toMatchObject({
      state: 'FAILED',
      reasonCode: 'BOOKING_FAILED',
    });
    expect(processor.cancelCalls).toHaveLength(1);
    expect(processor.captureCalls).toHaveLength(0);
    expect(store.counters.reservedCount).toBe(0);
    expect(store.counters.consumedCount).toBe(0);
  });

  it('retains authorization and reservation when booking needs reconciliation', async () => {
    const fulfill = vi.fn(async () => ({
      state: 'PENDING' as const,
      bookingId: 'booking-1',
      failureReason: 'AbortError',
    }));
    service = new PaymentService({ store, processor, clock, logger, fulfill });

    await expect(service.executeReserved(reserved())).resolves.toMatchObject({
      state: 'PAYMENT_PENDING',
    });
    expect(processor.captureCalls).toHaveLength(0);
    expect(processor.cancelCalls).toHaveLength(0);
    expect(store.counters.reservedCount).toBe(1);
  });

  it('retains authorization when fulfillment throws unexpectedly', async () => {
    const fulfill = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    service = new PaymentService({ store, processor, clock, logger, fulfill });

    await expect(service.executeReserved(reserved())).resolves.toMatchObject({
      state: 'PAYMENT_PENDING',
    });
    expect(processor.captureCalls).toHaveLength(0);
    expect(processor.cancelCalls).toHaveLength(0);
  });
});
