import { describe, expect, it, vi } from 'vitest';
import type { PaymentEvent } from '@authera/contracts';
import { fixedClock } from '../../clock.js';
import { MockPaymentProcessor } from './mock-processor.js';

const purchase = (executionId: string) => ({
  executionId,
  amount: { currency: 'USD' as const, minor: 13_000 },
  merchantId: 'm',
  paymentMethodRef: 'pm_ref',
  description: 'test',
});

describe('MockPaymentProcessor', () => {
  it('authorizes then captures by default with stable provider ids', async () => {
    const mock = new MockPaymentProcessor(fixedClock('2026-08-30T12:00:00.000Z'));
    const first = await mock.purchase(purchase('e1'));
    const again = await mock.purchase(purchase('e1'));
    expect(first).toMatchObject({ provider: 'mock', state: 'AUTHORIZED', failureReason: null });
    expect(first.providerPaymentId).toMatch(/^mock_pay_/);
    expect(first.providerTransactionId).toBeNull();
    expect(again).toEqual(first);
    expect(mock.calls.map((c) => c.idempotentReplay)).toEqual([false, true]);
    const captured = await mock.capture({
      executionId: 'e1',
      providerPaymentId: first.providerPaymentId,
    });
    expect(captured).toMatchObject({ state: 'SUCCEEDED', failureReason: null });
    expect(captured.providerTransactionId).toMatch(/^mock_txn_/);
  });

  it('fails when told to, with the configured reason', async () => {
    const mock = new MockPaymentProcessor(fixedClock('2026-08-30T12:00:00.000Z'));
    mock.setBehavior('e2', { outcome: 'fail', failureReason: 'insufficient_funds' });
    expect(await mock.purchase(purchase('e2'))).toMatchObject({
      state: 'FAILED',
      failureReason: 'insufficient_funds',
      providerTransactionId: null,
    });
    mock.setDefaultBehavior({ outcome: 'fail' });
    expect((await mock.purchase(purchase('e3'))).state).toBe('FAILED');
  });

  it('returns PENDING and delivers the final webhook later, including duplicates', async () => {
    vi.useFakeTimers();
    try {
      const mock = new MockPaymentProcessor(fixedClock('2026-08-30T12:00:00.000Z'));
      const delivered: PaymentEvent[] = [];
      mock.onWebhook(async (event) => {
        delivered.push(event);
      });
      mock.setBehavior('e4', {
        outcome: 'pending',
        webhookDelayMs: 100,
        pendingResolvesTo: 'succeed',
        duplicateWebhooks: 2,
      });
      const result = await mock.purchase(purchase('e4'));
      expect(result.state).toBe('PENDING');
      expect(delivered).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(200);
      expect(delivered).toHaveLength(3);
      expect(new Set(delivered.map((e) => e.eventId)).size).toBe(1);
      expect(delivered[0]).toMatchObject({
        eventType: 'PAYMENT_SUCCEEDED',
        executionId: 'e4',
        providerPaymentId: result.providerPaymentId,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets deterministically and cancels scheduled deliveries', async () => {
    vi.useFakeTimers();
    try {
      const mock = new MockPaymentProcessor(fixedClock('2026-08-30T12:00:00.000Z'));
      const delivered: PaymentEvent[] = [];
      mock.onWebhook(async (event) => {
        delivered.push(event);
      });
      mock.setBehavior('e5', { outcome: 'pending', webhookDelayMs: 50 });
      await mock.purchase(purchase('e5'));
      mock.reset();
      await vi.advanceTimersByTimeAsync(100);
      expect(delivered).toHaveLength(0);
      expect(mock.calls).toHaveLength(0);
      expect(mock.resultFor('e5')).toBeUndefined();
      expect(mock.getDefaultBehavior()).toEqual({ outcome: 'succeed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('parses only well-formed PaymentEvent webhooks', async () => {
    const mock = new MockPaymentProcessor(fixedClock('2026-08-30T12:00:00.000Z'));
    const event = mock.buildEvent({
      executionId: '4c0f2c2e-2b2e-4b6c-8a5e-7c8c1e6b9a11',
      amount: { currency: 'USD', minor: 1 },
      type: 'PAYMENT_FAILED',
    });
    expect(await mock.parseWebhook(new TextEncoder().encode(JSON.stringify(event)))).toEqual(event);
    await expect(mock.parseWebhook(new TextEncoder().encode('{"nope":true}'))).rejects.toThrow(
      'not a PaymentEvent',
    );
    await expect(mock.parseWebhook(new TextEncoder().encode('garbage'))).rejects.toThrow(
      'not JSON',
    );
  });
});
