import type { PaymentEvent, PaymentProvider, PaymentState } from '@authera/contracts';
import {
  appendAuditEvent,
  createPayment,
  getPaymentByExecution,
  markWebhookProcessed,
  recordWebhookEvent,
  settleExecution,
  transitionExecution,
  transitionPayment,
  updateCheckoutStatus,
  type AppendAuditEventInput,
  type Database,
  type SettleExecutionResult,
} from '@authera/db';

export interface PaymentRecord {
  id: string;
  executionId: string;
  provider: PaymentProvider;
  state: PaymentState;
  providerPaymentId: string | null;
}

/** Persistence needed by the payment service; database and in-memory implementations. */
export interface PaymentStore {
  /** Create the payment row (CREATED) and audit PAYMENT_REQUESTED in one transaction; idempotent. */
  requestPayment(input: {
    executionId: string;
    provider: PaymentProvider;
    amountMinor: number;
    currency: string;
    checkoutId: string;
    mandateId: string;
    mandateVersion: number;
  }): Promise<PaymentRecord>;
  getPayment(executionId: string): Promise<PaymentRecord | undefined>;
  /** PENDING result: payment → PENDING, execution → PAYMENT_PENDING, audit PAYMENT_PENDING. */
  markPending(input: {
    executionId: string;
    providerPaymentId: string;
    eventId: string;
    mandateId: string;
    mandateVersion: number;
  }): Promise<void>;
  /** Terminal result: consume/release, payment, execution, audit — idempotent (spec §10). */
  settle(input: {
    executionId: string;
    outcome: 'succeeded' | 'failed';
    provider: PaymentProvider;
    providerPaymentId: string | null;
    providerTransactionId: string | null;
    eventId: string | null;
    failureReason: string | null;
    actorType: 'SYSTEM' | 'PROVIDER';
    checkoutId: string | null;
  }): Promise<SettleExecutionResult>;
  /** Deduplicate a provider event; audit WEBHOOK_RECEIVED or WEBHOOK_DUPLICATE. */
  recordWebhook(event: PaymentEvent): Promise<{ id: string; duplicate: boolean }>;
  markWebhook(id: string, state: 'PROCESSED' | 'IGNORED' | 'REJECTED'): Promise<void>;
  getExecutionContext(executionId: string): Promise<
    | {
        checkoutId: string | null;
        mandateId: string | null;
        mandateVersion: number | null;
        state: string;
      }
    | undefined
  >;
  audit(event: AppendAuditEventInput): Promise<void>;
}

export function databasePaymentStore(db: Database): PaymentStore {
  return {
    requestPayment(input) {
      return db.transaction(async (tx) => {
        const row = await createPayment(tx, {
          executionId: input.executionId,
          provider: input.provider,
          amountMinor: input.amountMinor,
          currency: input.currency,
        });
        if (row.state === 'CREATED') {
          await appendAuditEvent(tx, {
            eventType: 'PAYMENT_REQUESTED',
            actorType: 'SYSTEM',
            mandateId: input.mandateId,
            mandateVersion: input.mandateVersion,
            executionId: input.executionId,
            checkoutId: input.checkoutId,
            paymentId: row.id,
            payload: {
              provider: input.provider,
              amountMinor: input.amountMinor,
              currency: input.currency,
            },
          });
        }
        return {
          id: row.id,
          executionId: row.executionId,
          provider: row.provider as PaymentProvider,
          state: row.state as PaymentState,
          providerPaymentId: row.providerPaymentId,
        };
      });
    },
    async getPayment(executionId) {
      const row = await getPaymentByExecution(db, executionId);
      return row
        ? {
            id: row.id,
            executionId: row.executionId,
            provider: row.provider as PaymentProvider,
            state: row.state as PaymentState,
            providerPaymentId: row.providerPaymentId,
          }
        : undefined;
    },
    markPending(input) {
      return db.transaction(async (tx) => {
        const payment = await getPaymentByExecution(tx, input.executionId);
        if (!payment) throw new Error(`payment for execution ${input.executionId} not found`);
        const { changed } = await transitionPayment(tx, payment.id, 'PENDING', {
          providerPaymentId: input.providerPaymentId,
          lastEventId: input.eventId,
        });
        if (!changed) return;
        await transitionExecution(tx, input.executionId, 'PAYMENT_PENDING');
        await appendAuditEvent(tx, {
          eventType: 'PAYMENT_PENDING',
          actorType: 'SYSTEM',
          mandateId: input.mandateId,
          mandateVersion: input.mandateVersion,
          executionId: input.executionId,
          paymentId: payment.id,
          detail: input.providerPaymentId,
          payload: { providerPaymentId: input.providerPaymentId, eventId: input.eventId },
        });
      });
    },
    async settle(input) {
      const result = await settleExecution(db, {
        executionId: input.executionId,
        outcome: input.outcome,
        payment: {
          provider: input.provider,
          providerPaymentId: input.providerPaymentId,
          providerTransactionId: input.providerTransactionId,
          lastEventId: input.eventId,
          failureReason: input.failureReason,
        },
        actorType: input.actorType,
      });
      if (result.applied && input.outcome === 'succeeded' && input.checkoutId) {
        await updateCheckoutStatus(db, input.checkoutId, 'COMPLETED');
      }
      return result;
    },
    recordWebhook(event) {
      return db.transaction(async (tx) => {
        const { event: row, duplicate } = await recordWebhookEvent(tx, {
          provider: event.provider,
          providerEventId: event.eventId,
          executionId: event.executionId,
          payload: event,
        });
        await appendAuditEvent(tx, {
          eventType: duplicate ? 'WEBHOOK_DUPLICATE' : 'WEBHOOK_RECEIVED',
          actorType: 'PROVIDER',
          actorId: event.provider,
          executionId: event.executionId,
          detail: `${event.eventType} ${event.eventId}`,
          payload: {
            eventId: event.eventId,
            eventType: event.eventType,
            providerPaymentId: event.providerPaymentId,
          },
        });
        return { id: row.id, duplicate };
      });
    },
    markWebhook: (id, state) => markWebhookProcessed(db, id, state),
    async getExecutionContext(executionId) {
      const { getExecution } = await import('@authera/db');
      const row = await getExecution(db, executionId);
      return row
        ? {
            checkoutId: row.checkoutId,
            mandateId: row.mandateId,
            mandateVersion: row.mandateVersion,
            state: row.state,
          }
        : undefined;
    },
    async audit(event) {
      await db.transaction((tx) => appendAuditEvent(tx, event));
    },
  };
}
