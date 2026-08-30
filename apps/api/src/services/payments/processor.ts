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
  /** AUTHORIZED means funds are held but must not be captured until fulfillment succeeds. */
  state: 'AUTHORIZED' | 'PENDING' | 'SUCCEEDED' | 'FAILED';
  failureReason: string | null;
  eventId: string;
}

export interface AuthorizedPaymentInput {
  executionId: string;
  providerPaymentId: string;
}

/** Provider boundary (CLAUDE_IMPLEMENTATION_SPEC.md §13). Adapters never hold a database transaction. */
export interface PaymentProcessor {
  readonly provider: PaymentProvider;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  purchase(input: PurchaseInput): Promise<PaymentResult>;
  capture(input: AuthorizedPaymentInput): Promise<PaymentResult>;
  cancel(input: AuthorizedPaymentInput): Promise<PaymentResult>;
  /** The processor's own receipt page for a completed payment (Stripe hosts one per charge). */
  hostedReceiptUrl?(providerPaymentId: string): Promise<string | null>;
  parseWebhook(rawBody: Uint8Array, headers: Headers): Promise<PaymentEvent>;
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}
