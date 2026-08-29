import { z } from 'zod';
import { MoneySchema } from './money.js';

export const PaymentStateSchema = z.enum(['CREATED', 'PENDING', 'SUCCEEDED', 'FAILED']);
export type PaymentState = z.infer<typeof PaymentStateSchema>;

export const PaymentProviderSchema = z.enum(['mock', 'yuno']);
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

export const PaymentEventTypeSchema = z.enum([
  'PAYMENT_PENDING',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
]);
export type PaymentEventType = z.infer<typeof PaymentEventTypeSchema>;

/** Provider-neutral, authenticated payment event (after HMAC/identity verification). */
export const PaymentEventSchema = z.strictObject({
  provider: PaymentProviderSchema,
  eventId: z.string().min(1),
  eventType: PaymentEventTypeSchema,
  providerPaymentId: z.string().min(1),
  executionId: z.uuid(),
  amount: MoneySchema,
  occurredAt: z.iso.datetime(),
});
export type PaymentEvent = z.infer<typeof PaymentEventSchema>;
