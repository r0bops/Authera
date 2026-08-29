import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentEvent, PaymentEventType } from '@agentcerta/contracts';
import type {
  CheckoutSessionInput,
  CheckoutSessionResult,
  PaymentProcessor,
  PaymentResult,
  PurchaseInput,
} from './processor.js';
import { WebhookVerificationError } from './processor.js';

export interface YunoConfig {
  publicApiKey: string;
  privateSecretKey: string;
  accountId: string;
  webhookSecret: string;
  baseUrl?: string;
  countryCode?: string;
}

/** Header carrying the HMAC-SHA256 hex signature of the raw webhook body (assumed name; verify against Yuno docs). */
export const YUNO_SIGNATURE_HEADER = 'x-signature';
export const YUNO_SANDBOX_BASE_URL = 'https://api-sandbox.y.uno';

/**
 * Yuno sandbox adapter skeleton (spec §13). Configuration-selected (`PAYMENT_MODE=yuno`); the
 * demo runs entirely on the mock. Field names follow the public Yuno REST docs as understood at
 * build time and are unverified against a live sandbox — see IMPLEMENTATION_STATUS.md.
 */
export class YunoPaymentProcessor implements PaymentProcessor {
  readonly provider = 'yuno' as const;

  constructor(
    private readonly config: YunoConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(idempotencyKey?: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      'public-api-key': this.config.publicApiKey,
      'private-secret-key': this.config.privateSecretKey,
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    };
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const response = await this.fetchImpl(
      `${this.config.baseUrl ?? YUNO_SANDBOX_BASE_URL}/v1/checkout/sessions`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          account_id: this.config.accountId,
          merchant_order_id: input.executionId,
          country: this.config.countryCode ?? 'CO',
          customer_id: input.customerRef,
          amount: { currency: input.amount.currency, value: input.amount.minor / 100 },
        }),
      },
    );
    if (!response.ok) throw new Error(`Yuno checkout session failed: HTTP ${response.status}`);
    const body = (await response.json()) as { checkout_session?: string };
    if (!body.checkout_session)
      throw new Error('Yuno checkout session response missing checkout_session');
    return {
      provider: 'yuno',
      sessionId: body.checkout_session,
      clientToken: this.config.publicApiKey,
    };
  }

  async purchase(input: PurchaseInput): Promise<PaymentResult> {
    const response = await this.fetchImpl(
      `${this.config.baseUrl ?? YUNO_SANDBOX_BASE_URL}/v1/payments`,
      {
        method: 'POST',
        headers: this.headers(input.executionId),
        body: JSON.stringify({
          account_id: this.config.accountId,
          merchant_order_id: input.executionId,
          description: input.description,
          country: this.config.countryCode ?? 'CO',
          amount: { currency: input.amount.currency, value: input.amount.minor / 100 },
          workflow: 'DIRECT',
          payment_method: { vaulted_token: input.paymentMethodRef },
        }),
      },
    );
    // 409 on an idempotency-key conflict means the operation already exists (spec §13).
    if (response.status === 409) {
      return {
        provider: 'yuno',
        providerPaymentId: `pending:${input.executionId}`,
        providerTransactionId: null,
        state: 'PENDING',
        failureReason: null,
        eventId: `yuno_conflict_${input.executionId}`,
      };
    }
    if (!response.ok) throw new Error(`Yuno payment failed: HTTP ${response.status}`);
    const body = (await response.json()) as {
      id?: string;
      status?: string;
      transactions?: Array<{ id?: string; status?: string }>;
    };
    if (!body.id) throw new Error('Yuno payment response missing id');
    return {
      provider: 'yuno',
      providerPaymentId: body.id,
      providerTransactionId: body.transactions?.[0]?.id ?? null,
      state: mapYunoStatus(body.status),
      failureReason: mapYunoStatus(body.status) === 'FAILED' ? (body.status ?? 'declined') : null,
      eventId: `yuno_sync_${body.id}`,
    };
  }

  /** HMAC-SHA256 over the raw bytes; length check, then constant-time compare; parse JSON only after. */
  async parseWebhook(rawBody: Uint8Array, headers: Headers): Promise<PaymentEvent> {
    const received = headers.get(YUNO_SIGNATURE_HEADER);
    if (!received) throw new WebhookVerificationError('missing webhook signature');
    const expected = createHmac('sha256', this.config.webhookSecret).update(rawBody).digest('hex');
    const receivedBuffer = Buffer.from(received.trim(), 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      throw new WebhookVerificationError('webhook signature mismatch');
    }
    let payload: {
      id?: string;
      merchant_order_id?: string;
      status?: string;
      amount?: { currency?: string; value?: number };
      transactions?: Array<{ id?: string }>;
    };
    try {
      payload = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      throw new WebhookVerificationError('webhook body is not JSON');
    }
    if (!payload.id || !payload.merchant_order_id)
      throw new WebhookVerificationError('webhook payload missing ids');
    const state = mapYunoStatus(payload.status);
    const eventType: PaymentEventType =
      state === 'SUCCEEDED'
        ? 'PAYMENT_SUCCEEDED'
        : state === 'FAILED'
          ? 'PAYMENT_FAILED'
          : 'PAYMENT_PENDING';
    return {
      provider: 'yuno',
      eventId: `${payload.id}:${payload.status ?? 'unknown'}`,
      eventType,
      providerPaymentId: payload.id,
      executionId: payload.merchant_order_id,
      amount: {
        currency: (payload.amount?.currency ?? 'USD') as PaymentEvent['amount']['currency'],
        minor: Math.round((payload.amount?.value ?? 0) * 100),
      },
      occurredAt: new Date().toISOString(),
    };
  }
}

export function mapYunoStatus(status: string | undefined): 'PENDING' | 'SUCCEEDED' | 'FAILED' {
  switch ((status ?? '').toUpperCase()) {
    case 'SUCCEEDED':
    case 'APPROVED':
      return 'SUCCEEDED';
    case 'DECLINED':
    case 'ERROR':
    case 'REJECTED':
    case 'CANCELED':
    case 'CANCELLED':
    case 'EXPIRED':
    case 'FAILED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}
