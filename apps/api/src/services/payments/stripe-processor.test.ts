import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WebhookVerificationError } from './processor.js';
import { StripePaymentProcessor } from './stripe-processor.js';

const EXECUTION = '00000000-0000-4000-8000-000000000001';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function purchaseInput() {
  return {
    executionId: EXECUTION,
    amount: { currency: 'USD' as const, minor: 13_000 },
    merchantId: 'checkout-1',
    paymentMethodRef: 'tok_mock_visa_4242_ref_7f3a',
    description: 'Authera execution',
  };
}

describe('StripePaymentProcessor', () => {
  it('refuses live keys', () => {
    expect(() => new StripePaymentProcessor({ secretKey: 'sk_live_abc' })).toThrow('test-mode');
  });

  it('confirms one manual-capture PaymentIntent with the execution id as idempotency key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return json(200, {
        id: 'pi_123',
        object: 'payment_intent',
        status: 'requires_capture',
        amount: 13_000,
        currency: 'usd',
        latest_charge: 'ch_456',
      });
    });
    const processor = new StripePaymentProcessor({
      secretKey: 'sk_test_x',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const result = await processor.purchase(purchaseInput());

    expect(result).toEqual({
      provider: 'stripe',
      providerPaymentId: 'pi_123',
      providerTransactionId: 'ch_456',
      state: 'AUTHORIZED',
      failureReason: null,
      eventId: 'stripe_pi_pi_123_requires_capture',
    });
    expect(calls[0]!.url).toBe('https://api.stripe.com/v1/payment_intents');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(EXECUTION);
    expect(headers.Authorization).toBe('Bearer sk_test_x');
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get('amount')).toBe('13000');
    expect(form.get('currency')).toBe('usd');
    expect(form.get('confirm')).toBe('true');
    expect(form.get('off_session')).toBe('true');
    expect(form.get('capture_method')).toBe('manual');
    // The seeded demo token is not a Stripe id, so the test fixture card is used instead.
    expect(form.get('payment_method')).toBe('pm_card_visa');
    expect(form.get('metadata[execution_id]')).toBe(EXECUTION);
  });

  it('captures and cancels an authorization with distinct stable idempotency keys', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const processor = new StripePaymentProcessor({
      secretKey: 'sk_test_x',
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        const canceled = String(url).endsWith('/cancel');
        return json(200, {
          id: 'pi_123',
          object: 'payment_intent',
          status: canceled ? 'canceled' : 'succeeded',
          amount: 13_000,
          currency: 'usd',
          latest_charge: canceled ? null : 'ch_456',
        });
      }) as typeof fetch,
    });
    await expect(
      processor.capture({ executionId: EXECUTION, providerPaymentId: 'pi_123' }),
    ).resolves.toMatchObject({ state: 'SUCCEEDED', providerTransactionId: 'ch_456' });
    await expect(
      processor.cancel({ executionId: EXECUTION, providerPaymentId: 'pi_123' }),
    ).resolves.toMatchObject({ state: 'FAILED', failureReason: 'canceled' });
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.stripe.com/v1/payment_intents/pi_123/capture',
      'https://api.stripe.com/v1/payment_intents/pi_123/cancel',
    ]);
    expect(
      calls.map((call) => (call.init.headers as Record<string, string>)['Idempotency-Key']),
    ).toEqual([`${EXECUTION}:capture`, `${EXECUTION}:cancel`]);
  });

  it('maps a card decline (HTTP 402) to a FAILED result with the decline code', async () => {
    const processor = new StripePaymentProcessor({
      secretKey: 'sk_test_x',
      fetch: (async () =>
        json(402, {
          error: {
            type: 'card_error',
            code: 'card_declined',
            decline_code: 'insufficient_funds',
            payment_intent: { id: 'pi_declined', status: 'requires_payment_method' },
          },
        })) as typeof fetch,
    });
    await expect(processor.purchase(purchaseInput())).resolves.toMatchObject({
      state: 'FAILED',
      providerPaymentId: 'pi_declined',
      failureReason: 'insufficient_funds',
    });
  });

  it('reports processing intents as PENDING and passes pm_ references through', async () => {
    let body = '';
    const processor = new StripePaymentProcessor({
      secretKey: 'sk_test_x',
      fetch: (async (_url: unknown, init?: RequestInit) => {
        body = String(init?.body);
        return json(200, { id: 'pi_p', status: 'processing', amount: 1, currency: 'usd' });
      }) as typeof fetch,
    });
    const result = await processor.purchase({ ...purchaseInput(), paymentMethodRef: 'pm_abc' });
    expect(result.state).toBe('PENDING');
    expect(new URLSearchParams(body).get('payment_method')).toBe('pm_abc');
  });

  it('verifies the Stripe-Signature header and maps payment_intent events', async () => {
    const secret = 'whsec_test';
    const now = new Date('2026-08-29T20:00:00.000Z');
    const processor = new StripePaymentProcessor({
      secretKey: 'sk_test_x',
      webhookSecret: secret,
      now: () => now,
    });
    const payload = JSON.stringify({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      created: Math.floor(now.getTime() / 1000) - 10,
      data: {
        object: {
          id: 'pi_123',
          object: 'payment_intent',
          status: 'succeeded',
          amount: 13_000,
          currency: 'usd',
          metadata: { execution_id: EXECUTION },
        },
      },
    });
    const raw = new TextEncoder().encode(payload);
    const t = Math.floor(now.getTime() / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');

    await expect(
      processor.parseWebhook(raw, new Headers({ 'stripe-signature': `t=${t},v1=${sig}` })),
    ).resolves.toEqual({
      provider: 'stripe',
      eventId: 'evt_1',
      eventType: 'PAYMENT_SUCCEEDED',
      providerPaymentId: 'pi_123',
      executionId: EXECUTION,
      amount: { currency: 'USD', minor: 13_000 },
      occurredAt: new Date((t - 10) * 1000).toISOString(),
    });

    await expect(
      processor.parseWebhook(
        raw,
        new Headers({ 'stripe-signature': `t=${t},v1=${'0'.repeat(64)}` }),
      ),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
    const stale = t - 10 * 60;
    const staleSig = createHmac('sha256', secret).update(`${stale}.`).update(raw).digest('hex');
    await expect(
      processor.parseWebhook(raw, new Headers({ 'stripe-signature': `t=${stale},v1=${staleSig}` })),
    ).rejects.toThrow('tolerance');
  });

  it('maps amount_capturable_updated to a pending authenticated event', async () => {
    const secret = 'whsec_test';
    const now = new Date('2026-08-29T20:00:00.000Z');
    const processor = new StripePaymentProcessor({
      secretKey: 'sk_test_x',
      webhookSecret: secret,
      now: () => now,
    });
    const timestamp = Math.floor(now.getTime() / 1000);
    const payload = JSON.stringify({
      id: 'evt_authorized',
      type: 'payment_intent.amount_capturable_updated',
      created: timestamp,
      data: {
        object: {
          id: 'pi_123',
          status: 'requires_capture',
          amount: 13_000,
          currency: 'usd',
          metadata: { execution_id: EXECUTION },
        },
      },
    });
    const raw = new TextEncoder().encode(payload);
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(raw)
      .digest('hex');
    await expect(
      processor.parseWebhook(
        raw,
        new Headers({ 'stripe-signature': `t=${timestamp},v1=${signature}` }),
      ),
    ).resolves.toMatchObject({ eventType: 'PAYMENT_PENDING' });
  });

  it('rejects every webhook when no signing secret is configured', async () => {
    const processor = new StripePaymentProcessor({ secretKey: 'sk_test_x' });
    await expect(
      processor.parseWebhook(new Uint8Array(), new Headers({ 'stripe-signature': 't=1,v1=a' })),
    ).rejects.toThrow('not configured');
  });
});
