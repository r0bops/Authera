import type { PaymentEvent, PurchaseAttemptResponse } from '@authera/contracts';
import type { Clock } from '../../clock.js';
import type { Logger } from '../../logger.js';
import type { ReservedExecution } from '../gateway.js';
import type { PaymentRecord, PaymentStore } from './payment-store.js';
import type { PaymentProcessor } from './processor.js';

export interface PaymentServiceDependencies {
  store: PaymentStore;
  processor: PaymentProcessor;
  clock: Clock;
  logger: Logger;
}

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'unknown_execution';

/**
 * Payment execution after a committed reservation (spec §13, invariants 10–13):
 * the provider call happens outside every database transaction, uses the execution id as the
 * idempotency key, and its result is applied through the idempotent settlement transaction.
 */
export class PaymentService {
  constructor(private readonly deps: PaymentServiceDependencies) {}

  expectedPayment(executionId: string): Promise<PaymentRecord | undefined> {
    return this.deps.store.getPayment(executionId);
  }

  async executeReserved(reserved: ReservedExecution): Promise<Partial<PurchaseAttemptResponse>> {
    const { store, processor, logger } = this.deps;
    const payment = await store.requestPayment({
      executionId: reserved.executionId,
      provider: processor.provider,
      amountMinor: reserved.amountMinor,
      currency: reserved.currency,
      checkoutId: reserved.checkoutId,
      mandateId: reserved.mandateId,
      mandateVersion: reserved.mandateVersion,
    });
    if (payment.state === 'SUCCEEDED' || payment.state === 'FAILED') {
      // A retry after settlement: nothing to do with the provider.
      const ctx = await store.getExecutionContext(reserved.executionId);
      return {
        paymentId: payment.id,
        state: (ctx?.state as PurchaseAttemptResponse['state']) ?? 'RESERVED',
      };
    }

    let result;
    try {
      // No transaction is open here (invariant 11).
      result = await processor.purchase({
        executionId: reserved.executionId,
        amount: {
          currency: reserved.currency as PaymentEvent['amount']['currency'],
          minor: reserved.amountMinor,
        },
        merchantId: reserved.checkoutId,
        paymentMethodRef: reserved.paymentMethodRef,
        description: `Authera execution ${reserved.executionId}`,
      });
    } catch (error) {
      // Provider timeout/outage: leave a recoverable PENDING state, never a guessed success.
      logger.error(
        { err: error, executionId: reserved.executionId },
        'payment provider call failed',
      );
      await store.markPending({
        executionId: reserved.executionId,
        providerPaymentId: `unknown:${reserved.executionId}`,
        eventId: `provider_error_${reserved.executionId}`,
        mandateId: reserved.mandateId,
        mandateVersion: reserved.mandateVersion,
      });
      return { paymentId: payment.id, state: 'PAYMENT_PENDING' };
    }

    if (result.state === 'PENDING') {
      await store.markPending({
        executionId: reserved.executionId,
        providerPaymentId: result.providerPaymentId,
        eventId: result.eventId,
        mandateId: reserved.mandateId,
        mandateVersion: reserved.mandateVersion,
      });
      return { paymentId: payment.id, state: 'PAYMENT_PENDING' };
    }

    const settled = await store.settle({
      executionId: reserved.executionId,
      outcome: result.state === 'SUCCEEDED' ? 'succeeded' : 'failed',
      provider: processor.provider,
      providerPaymentId: result.providerPaymentId,
      providerTransactionId: result.providerTransactionId,
      eventId: result.eventId,
      failureReason: result.failureReason,
      actorType: 'SYSTEM',
      checkoutId: reserved.checkoutId,
    });
    logger.info(
      {
        executionId: reserved.executionId,
        outcome: settled.executionState,
        applied: settled.applied,
      },
      'payment settled',
    );
    return {
      paymentId: payment.id,
      state: settled.executionState,
      ...(settled.executionState === 'FAILED' ? { reasonCode: 'PAYMENT_FAILED' as const } : {}),
    };
  }

  /** Authenticated provider event (already HMAC/identity verified by the adapter). */
  async handleWebhook(event: PaymentEvent): Promise<WebhookOutcome> {
    const { store, logger } = this.deps;
    const recorded = await store.recordWebhook(event);
    if (recorded.duplicate) return 'duplicate';

    const ctx = await store.getExecutionContext(event.executionId);
    const payment = await store.getPayment(event.executionId);
    if (!ctx || !payment) {
      await store.markWebhook(recorded.id, 'REJECTED');
      return 'unknown_execution';
    }
    if (payment.state === 'SUCCEEDED' || payment.state === 'FAILED') {
      // Contradicting or late events are retained as evidence but never move a terminal payment.
      await store.markWebhook(recorded.id, 'IGNORED');
      return 'ignored';
    }
    const providerPaymentIdMatches =
      !payment.providerPaymentId ||
      payment.providerPaymentId.startsWith('unknown:') ||
      payment.providerPaymentId.startsWith('pending:') ||
      payment.providerPaymentId === event.providerPaymentId;
    if (
      payment.provider !== event.provider ||
      payment.amountMinor !== event.amount.minor ||
      payment.currency !== event.amount.currency ||
      !providerPaymentIdMatches
    ) {
      await store.markWebhook(recorded.id, 'REJECTED');
      logger.warn(
        { executionId: event.executionId, eventId: event.eventId },
        'webhook did not match the stored payment',
      );
      return 'ignored';
    }
    if (event.eventType === 'PAYMENT_PENDING') {
      await store.markPending({
        executionId: event.executionId,
        providerPaymentId: event.providerPaymentId,
        eventId: event.eventId,
        mandateId: ctx.mandateId ?? '',
        mandateVersion: ctx.mandateVersion ?? 0,
      });
      await store.markWebhook(recorded.id, 'PROCESSED');
      return 'processed';
    }
    const settled = await store.settle({
      executionId: event.executionId,
      outcome: event.eventType === 'PAYMENT_SUCCEEDED' ? 'succeeded' : 'failed',
      provider: event.provider,
      providerPaymentId: event.providerPaymentId,
      providerTransactionId: null,
      eventId: event.eventId,
      failureReason: event.eventType === 'PAYMENT_FAILED' ? 'provider_reported_failure' : null,
      actorType: 'PROVIDER',
      checkoutId: ctx.checkoutId,
    });
    await store.markWebhook(recorded.id, settled.applied ? 'PROCESSED' : 'IGNORED');
    logger.info(
      { executionId: event.executionId, eventId: event.eventId, applied: settled.applied },
      'webhook applied',
    );
    return settled.applied ? 'processed' : 'ignored';
  }
}
