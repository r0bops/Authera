import { randomUUID } from 'node:crypto';
import type { PaymentEvent, PaymentEventType } from '@authera/contracts';
import { PaymentEventSchema } from '@authera/contracts';
import type { Clock } from '../../clock.js';
import type {
  CheckoutSessionInput,
  CheckoutSessionResult,
  PaymentProcessor,
  PaymentResult,
  PurchaseInput,
} from './processor.js';
import { WebhookVerificationError } from './processor.js';

type MockOutcome = 'succeed' | 'fail' | 'pending';

export interface MockBehavior {
  outcome: MockOutcome;
  failureReason?: string;
  /** For `pending`: deliver the final webhook after this delay (ms). Omit = never (manual webhook). */
  webhookDelayMs?: number;
  /** For `pending`: the final outcome delivered by webhook. */
  pendingResolvesTo?: 'succeed' | 'fail';
  /** Deliver the final webhook this many extra times to prove idempotency (default 0). */
  duplicateWebhooks?: number;
}

export interface RecordedCall {
  at: string;
  executionId: string;
  amountMinor: number;
  currency: string;
  paymentMethodRef: string;
  idempotentReplay: boolean;
}

/**
 * The reference PaymentProcessor for P0 (spec §13): realistic states, provider ids, idempotency
 * by execution id, scheduled and duplicate webhook delivery, call recording, deterministic reset.
 * It is deliberately not an always-success function.
 */
export class MockPaymentProcessor implements PaymentProcessor {
  readonly provider = 'mock' as const;
  readonly calls: RecordedCall[] = [];
  private readonly results = new Map<string, PaymentResult>();
  private readonly behaviors = new Map<string, MockBehavior>();
  private defaultBehavior: MockBehavior = { outcome: 'succeed' };
  private readonly timers = new Set<NodeJS.Timeout>();
  private deliver: ((event: PaymentEvent) => Promise<unknown>) | undefined;

  constructor(private readonly clock: Clock) {}

  /** Register the in-process webhook sink (the payment service). */
  onWebhook(deliver: (event: PaymentEvent) => Promise<unknown>): void {
    this.deliver = deliver;
  }

  setDefaultBehavior(behavior: MockBehavior): void {
    this.defaultBehavior = behavior;
  }

  getDefaultBehavior(): MockBehavior {
    return { ...this.defaultBehavior };
  }

  /** Behavior for one execution id (demo controls: "make the next payment fail"). */
  setBehavior(executionId: string, behavior: MockBehavior): void {
    this.behaviors.set(executionId, behavior);
  }

  reset(): void {
    this.calls.length = 0;
    this.results.clear();
    this.behaviors.clear();
    this.defaultBehavior = { outcome: 'succeed' };
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  resultFor(executionId: string): PaymentResult | undefined {
    return this.results.get(executionId);
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    return { provider: 'mock', sessionId: `mock_cs_${input.executionId.slice(0, 8)}` };
  }

  async purchase(input: PurchaseInput): Promise<PaymentResult> {
    const existing = this.results.get(input.executionId);
    this.calls.push({
      at: this.clock.now().toISOString(),
      executionId: input.executionId,
      amountMinor: input.amount.minor,
      currency: input.amount.currency,
      paymentMethodRef: input.paymentMethodRef,
      idempotentReplay: existing !== undefined,
    });
    if (existing) return existing;

    const behavior = this.behaviors.get(input.executionId) ?? this.defaultBehavior;
    const providerPaymentId = `mock_pay_${randomUUID().slice(0, 12)}`;
    const base = {
      provider: 'mock' as const,
      providerPaymentId,
      eventId: `mock_evt_${randomUUID().slice(0, 12)}`,
    };
    let result: PaymentResult;
    switch (behavior.outcome) {
      case 'succeed':
        result = {
          ...base,
          providerTransactionId: `mock_txn_${randomUUID().slice(0, 12)}`,
          state: 'SUCCEEDED',
          failureReason: null,
        };
        break;
      case 'fail':
        result = {
          ...base,
          providerTransactionId: null,
          state: 'FAILED',
          failureReason: behavior.failureReason ?? 'card_declined',
        };
        break;
      case 'pending':
        result = { ...base, providerTransactionId: null, state: 'PENDING', failureReason: null };
        if (behavior.webhookDelayMs !== undefined) {
          this.scheduleWebhook(input, result, behavior);
        }
        break;
    }
    this.results.set(input.executionId, result);
    return result;
  }

  /** Build a provider event for an execution (used by scheduled delivery and the demo webhook route). */
  buildEvent(input: {
    executionId: string;
    amount: PurchaseInput['amount'];
    type: PaymentEventType;
    eventId?: string;
    providerPaymentId?: string;
  }): PaymentEvent {
    const known = this.results.get(input.executionId);
    return {
      provider: 'mock',
      eventId: input.eventId ?? `mock_evt_${randomUUID().slice(0, 12)}`,
      eventType: input.type,
      providerPaymentId:
        input.providerPaymentId ??
        known?.providerPaymentId ??
        `mock_pay_${input.executionId.slice(0, 8)}`,
      executionId: input.executionId,
      amount: input.amount,
      occurredAt: this.clock.now().toISOString(),
    };
  }

  private scheduleWebhook(
    input: PurchaseInput,
    pending: PaymentResult,
    behavior: MockBehavior,
  ): void {
    const finalType: PaymentEventType =
      (behavior.pendingResolvesTo ?? 'succeed') === 'succeed'
        ? 'PAYMENT_SUCCEEDED'
        : 'PAYMENT_FAILED';
    const event = this.buildEvent({
      executionId: input.executionId,
      amount: input.amount,
      type: finalType,
      providerPaymentId: pending.providerPaymentId,
    });
    const deliveries = 1 + (behavior.duplicateWebhooks ?? 0);
    for (let i = 0; i < deliveries; i += 1) {
      const timer = setTimeout(
        () => {
          this.timers.delete(timer);
          void this.deliver?.(event);
        },
        (behavior.webhookDelayMs ?? 0) + i * 5,
      );
      timer.unref();
      this.timers.add(timer);
    }
  }

  /** Mock webhooks are plain JSON; the demo route authenticates the caller instead. */
  async parseWebhook(rawBody: Uint8Array): Promise<PaymentEvent> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      throw new WebhookVerificationError('mock webhook body is not JSON');
    }
    const event = PaymentEventSchema.safeParse(parsed);
    if (!event.success)
      throw new WebhookVerificationError('mock webhook body is not a PaymentEvent');
    return event.data;
  }
}
