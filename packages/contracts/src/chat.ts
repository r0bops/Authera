import { z } from 'zod';
import { CurrencySchema } from './money.js';

export const MandateChatMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(1_000),
});
export type MandateChatMessage = z.infer<typeof MandateChatMessageSchema>;

/**
 * Deliberately flat and nullable: the model drafts authority but never invents required values.
 * The trusted surface only enables authorization once every field for the chosen intent exists.
 */
export const MandateChatDraftSchema = z.strictObject({
  category: z.literal('flight').nullable(),
  origin: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  destination: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  departureDateFrom: z.iso.date().nullable(),
  departureDateTo: z.iso.date().nullable(),
  dateFlexibilityDays: z.number().int().min(0).max(30).nullable(),
  passengerCount: z.number().int().min(1).max(9).nullable(),
  maxPerPurchaseMinor: z.number().int().min(1).nullable(),
  currency: CurrencySchema.nullable(),
  maxFulfillments: z.number().int().min(1).max(10).nullable(),
  validUntil: z.iso.datetime().nullable(),
  escalation: z.enum(['block', 'require_human']).nullable(),
});
export type MandateChatDraft = z.infer<typeof MandateChatDraftSchema>;

export const MandateChatRequestSchema = z.strictObject({
  messages: z.array(MandateChatMessageSchema).min(1).max(16),
  draft: MandateChatDraftSchema.nullable(),
});
export type MandateChatRequest = z.infer<typeof MandateChatRequestSchema>;

export const MandateChatModelOutputSchema = z.strictObject({
  reply: z.string().trim().min(1).max(500),
  draft: MandateChatDraftSchema,
  missingFields: z.array(
    z.enum([
      'category',
      'origin',
      'destination',
      'departureDates',
      'passengerCount',
      'maximumPrice',
      'purchaseCount',
      'validUntil',
      'outsideRules',
    ]),
  ),
  complete: z.boolean(),
});
export type MandateChatModelOutput = z.infer<typeof MandateChatModelOutputSchema>;

export const MandateChatResponseSchema = MandateChatModelOutputSchema.extend({
  interpreter: z.enum(['openai', 'scripted']),
});
export type MandateChatResponse = z.infer<typeof MandateChatResponseSchema>;
