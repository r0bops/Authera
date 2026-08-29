import type { Money, PaymentEvent, PaymentProvider } from '@authera/contracts';

export interface CheckoutSessionInput {
  executionId: string;
  amount: Money;
  merchantId: string;
  customerRef: string;
}

export interface CheckoutSessionResult {
  provider: PaymentProvider;
  sessionId: string;
  /** Public material the browser may receive (never a private key). */
  clientToken?: string;
}

export interface PurchaseInput {
  /** Stable application execution id — used verbatim as the provider idempotency key. */
  executionId: string;
  amount: Money;
  merchantId: string;
  /** Opaque token reference resolved server-side; never a raw card. */
  paymentMethodRef: string;
  description: string;
}

export interface PaymentResult {
  provider: PaymentProvider;
  providerPaymentId: string;
  providerTransactionId: string | null;
  state: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  failureReason: string | null;
  eventId: string;
}

/** Provider boundary (CLAUDE_IMPLEMENTATION_SPEC.md §13). Adapters never hold a database transaction. */
export interface PaymentProcessor {
  readonly provider: PaymentProvider;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  purchase(input: PurchaseInput): Promise<PaymentResult>;
  parseWebhook(rawBody: Uint8Array, headers: Headers): Promise<PaymentEvent>;
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}
