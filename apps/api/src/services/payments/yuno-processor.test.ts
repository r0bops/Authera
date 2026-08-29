import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mapYunoStatus, YUNO_SIGNATURE_HEADER, YunoPaymentProcessor } from './yuno-processor.js';

const config = {
  publicApiKey: 'pub',
  privateSecretKey: 'priv',
  accountId: 'acct',
  webhookSecret: 'whsec_test',
};

describe('YunoPaymentProcessor', () => {
  it('verifies the webhook HMAC over the raw bytes before parsing', async () => {
    const yuno = new YunoPaymentProcessor(config);
    const body = JSON.stringify({
      type: 'payment',
      type_event: 'payment.purchase',
      version: 2,
      retry: 0,
      data: {
        payment: {
          id: 'pay_1',
          merchant_order_id: '4c0f2c2e-2b2e-4b6c-8a5e-7c8c1e6b9a11',
          status: 'SUCCEEDED',
          amount: { currency: 'USD', value: 130 },
        },
      },
    });
    const raw = new TextEncoder().encode(body);
    const signature = createHmac('sha256', config.webhookSecret).update(raw).digest('base64');
    const event = await yuno.parseWebhook(raw, new Headers({ [YUNO_SIGNATURE_HEADER]: signature }));
    expect(event).toMatchObject({
      provider: 'yuno',
      eventType: 'PAYMENT_SUCCEEDED',
      providerPaymentId: 'pay_1',
      amount: { currency: 'USD', minor: 13_000 },
    });

    await expect(yuno.parseWebhook(raw, new Headers())).rejects.toThrow(
      'missing webhook signature',
    );
    await expect(
      yuno.parseWebhook(raw, new Headers({ [YUNO_SIGNATURE_HEADER]: 'abcd' })),
    ).rejects.toThrow('signature mismatch');
    const tampered = new TextEncoder().encode(body.replace('130', '1'));
    await expect(
      yuno.parseWebhook(tampered, new Headers({ [YUNO_SIGNATURE_HEADER]: signature })),
    ).rejects.toThrow('signature mismatch');
  });

  it('uses the execution id as the idempotency key and treats 409 as an existing operation', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: String(init?.body),
      });
      return new Response(
        JSON.stringify({ id: 'pay_9', status: 'SUCCEEDED', transactions: [{ id: 'txn_9' }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const yuno = new YunoPaymentProcessor(config, fetchImpl);
    const result = await yuno.purchase({
      executionId: 'exec-1',
      amount: { currency: 'USD', minor: 13_000 },
      merchantId: 'm',
      paymentMethodRef: 'vault_1',
      description: 'd',
    });
    expect(result).toMatchObject({
      providerPaymentId: 'pay_9',
      providerTransactionId: 'txn_9',
      state: 'SUCCEEDED',
    });
    expect(seen[0]?.headers['X-Idempotency-Key']).toBe('exec-1');
    expect(seen[0]?.body).not.toContain('4242');

    const conflict = new YunoPaymentProcessor(
      config,
      (async () => new Response('{}', { status: 409 })) as typeof fetch,
    );
    expect(
      (
        await conflict.purchase({
          executionId: 'exec-1',
          amount: { currency: 'USD', minor: 1 },
          merchantId: 'm',
          paymentMethodRef: 'v',
          description: 'd',
        })
      ).state,
    ).toBe('PENDING');
  });

  it('maps provider statuses conservatively', () => {
    expect(mapYunoStatus('SUCCEEDED')).toBe('SUCCEEDED');
    expect(mapYunoStatus('DECLINED')).toBe('FAILED');
    expect(mapYunoStatus('CREATED')).toBe('PENDING');
    expect(mapYunoStatus(undefined)).toBe('PENDING');
  });
});
