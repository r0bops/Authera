import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentEvent, PaymentEventType } from '@authera/contracts';
import { PaymentEventSchema } from '@authera/contracts';
import type {
  CheckoutSessionInput,
  CheckoutSessionResult,
  AuthorizedPaymentInput,
  PaymentProcessor,
  PaymentResult,
  PurchaseInput,
} from './processor.js';
import { WebhookVerificationError } from './processor.js';

export const STRIPE_BASE_URL = 'https://api.stripe.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const WEBHOOK_TOLERANCE_S = 5 * 60;

export interface StripeProcessorConfig {
  /** `sk_test_…` for the hackathon; live keys are refused. */
  secretKey: string;
  /** `whsec_…`; without it every webhook is rejected as unverified. */
  webhookSecret?: string | undefined;
  /**
   * Stripe test payment method used when the stored reference is not a Stripe `pm_…` id
   * (the seeded demo card is a mock token). `pm_card_visa` succeeds; `pm_card_chargeDeclined`
   * declines — both are Stripe test fixtures, never real cards.
   */
  fallbackPaymentMethod?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
}

interface StripePaymentIntent {
  id: string;
  object: 'payment_intent';
  status:
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'processing'
    | 'requires_capture'
    | 'canceled'
    | 'succeeded';
  amount: number;
  currency: string;
  latest_charge?: string | { id: string } | null;
  last_payment_error?: { code?: string; decline_code?: string; message?: string } | null;
  metadata?: Record<string, string>;
}

interface StripeErrorBody {
  error: {
    type: string;
    code?: string;
    decline_code?: string;
    message?: string;
    payment_intent?: StripePaymentIntent;
  };
}

/**
 * Stripe PaymentIntents adapter (test mode). It authorizes with manual capture, allowing the
 * Duffel sandbox order to be confirmed before funds are captured. Every provider mutation has a
 * stable execution-derived idempotency key. Never holds a database transaction.
 */
export class StripePaymentProcessor implements PaymentProcessor {
  readonly provider = 'stripe' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  /** Stripe's hosted receipt for the PaymentIntent's charge — third-party proof the payment ran. */
  async hostedReceiptUrl(providerPaymentId: string): Promise<string | null> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/payment_intents/${encodeURIComponent(providerPaymentId)}?expand[]=latest_charge`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.config.secretKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) return null;
    const intent = (await response.json()) as {
      latest_charge?: string | { receipt_url?: string | null } | null;
    };
    const charge = intent.latest_charge;
    return charge && typeof charge === 'object' ? (charge.receipt_url ?? null) : null;
  }

  constructor(private readonly config: StripeProcessorConfig) {
    if (!config.secretKey.startsWith('sk_test_') && !config.secretKey.startsWith('rk_test_')) {
      throw new Error('StripePaymentProcessor only accepts test-mode secret keys');
    }
    this.fetchImpl = config.fetch ?? fetch;
    this.baseUrl = config.baseUrl ?? STRIPE_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = config.now ?? (() => new Date());
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    // The agent flow charges a vaulted method server-side; no hosted checkout is needed.
    return { provider: 'stripe', sessionId: `stripe_cs_${input.executionId.slice(0, 8)}` };
  }

  async purchase(input: PurchaseInput): Promise<PaymentResult> {
    const paymentMethod = input.paymentMethodRef.startsWith('pm_')
      ? input.paymentMethodRef
      : (this.config.fallbackPaymentMethod ?? 'pm_card_visa');
    const form = new URLSearchParams({
      amount: String(input.amount.minor),
      currency: input.amount.currency.toLowerCase(),
      confirm: 'true',
      off_session: 'true',
      capture_method: 'manual',
      payment_method: paymentMethod,
      description: input.description,
      'automatic_payment_methods[enabled]': 'true',
      'automatic_payment_methods[allow_redirects]': 'never',
      'metadata[execution_id]': input.executionId,
      'metadata[merchant_ref]': input.merchantId,
    });
    const response = await this.fetchImpl(`${this.baseUrl}/v1/payment_intents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': input.executionId,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (response.status === 402) {
      // Card declined: Stripe returns the failed intent inside the error body.
      const body = (await response.json()) as StripeErrorBody;
      const intent = body.error.payment_intent;
      return {
        provider: 'stripe',
        providerPaymentId: intent?.id ?? `stripe_declined_${input.executionId}`,
        providerTransactionId: chargeId(intent),
        state: 'FAILED',
        failureReason: body.error.decline_code ?? body.error.code ?? 'card_declined',
        eventId: `stripe_pi_${intent?.id ?? input.executionId}_failed`,
      };
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Stripe payment_intents failed with HTTP ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    const intent = (await response.json()) as StripePaymentIntent;
    return this.toResult(intent);
  }

  async capture(input: AuthorizedPaymentInput): Promise<PaymentResult> {
    return this.intentAction(input, 'capture');
  }

  async cancel(input: AuthorizedPaymentInput): Promise<PaymentResult> {
    return this.intentAction(input, 'cancel');
  }

  private async intentAction(
    input: AuthorizedPaymentInput,
    action: 'capture' | 'cancel',
  ): Promise<PaymentResult> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/payment_intents/${encodeURIComponent(input.providerPaymentId)}/${action}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': `${input.executionId}:${action}`,
        },
        body: '',
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Stripe payment_intent ${action} failed with HTTP ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    return this.toResult((await response.json()) as StripePaymentIntent);
  }

  private toResult(intent: StripePaymentIntent): PaymentResult {
    const base = {
      provider: 'stripe' as const,
      providerPaymentId: intent.id,
      providerTransactionId: chargeId(intent),
      eventId: `stripe_pi_${intent.id}_${intent.status}`,
    };
    switch (intent.status) {
      case 'succeeded':
        return { ...base, state: 'SUCCEEDED', failureReason: null };
      case 'processing':
      case 'requires_action':
        return { ...base, state: 'PENDING', failureReason: null };
      case 'requires_capture':
        return { ...base, state: 'AUTHORIZED', failureReason: null };
      default:
        return {
          ...base,
          state: 'FAILED',
          failureReason:
            intent.last_payment_error?.decline_code ??
            intent.last_payment_error?.code ??
            intent.status,
        };
    }
  }

  /** Verifies `Stripe-Signature` (HMAC-SHA256 over `t.rawBody`) before parsing the event. */
  async parseWebhook(rawBody: Uint8Array, headers: Headers): Promise<PaymentEvent> {
    if (!this.config.webhookSecret) {
      throw new WebhookVerificationError('Stripe webhook secret is not configured');
    }
    const header = headers.get('stripe-signature');
    if (!header) throw new WebhookVerificationError('Missing Stripe-Signature header');
    const parts = new Map<string, string[]>();
    for (const item of header.split(',')) {
      const [key, value] = item.trim().split('=', 2);
      if (!key || value === undefined) continue;
      parts.set(key, [...(parts.get(key) ?? []), value]);
    }
    const timestamp = Number(parts.get('t')?.[0]);
    const signatures = parts.get('v1') ?? [];
    if (!Number.isFinite(timestamp) || signatures.length === 0) {
      throw new WebhookVerificationError('Malformed Stripe-Signature header');
    }
    if (Math.abs(this.now().getTime() / 1000 - timestamp) > WEBHOOK_TOLERANCE_S) {
      throw new WebhookVerificationError('Stripe webhook timestamp outside tolerance');
    }
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const valid = signatures.some((sig) => {
      const buf = Buffer.from(sig, 'hex');
      return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
    });
    if (!valid) throw new WebhookVerificationError('Stripe webhook signature mismatch');

    let event: {
      id: string;
      type: string;
      created: number;
      data: { object: StripePaymentIntent };
    };
    try {
      event = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    } catch {
      throw new WebhookVerificationError('Stripe webhook body is not JSON');
    }
    const eventType = mapEventType(event.type);
    if (!eventType) throw new WebhookVerificationError(`Unsupported Stripe event ${event.type}`);
    const intent = event.data.object;
    const executionId = intent.metadata?.execution_id;
    if (!executionId) throw new WebhookVerificationError('Stripe event carries no execution id');
    return PaymentEventSchema.parse({
      provider: 'stripe',
      eventId: event.id,
      eventType,
      providerPaymentId: intent.id,
      executionId,
      amount: { currency: intent.currency.toUpperCase(), minor: intent.amount },
      occurredAt: new Date(event.created * 1000).toISOString(),
    });
  }
}

function chargeId(intent: StripePaymentIntent | undefined): string | null {
  const charge = intent?.latest_charge;
  if (!charge) return null;
  return typeof charge === 'string' ? charge : charge.id;
}

function mapEventType(type: string): PaymentEventType | null {
  switch (type) {
    case 'payment_intent.succeeded':
      return 'PAYMENT_SUCCEEDED';
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled':
      return 'PAYMENT_FAILED';
    case 'payment_intent.processing':
    case 'payment_intent.amount_capturable_updated':
      return 'PAYMENT_PENDING';
    default:
      return null;
  }
}
