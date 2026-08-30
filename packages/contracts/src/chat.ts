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

export type MandateChatMissingField = MandateChatModelOutput['missingFields'][number];

/** The order in which the assistant asks for what is still missing. */
export const MANDATE_CHAT_FIELD_ORDER: readonly MandateChatMissingField[] = [
  'category',
  'origin',
  'destination',
  'departureDates',
  'passengerCount',
  'maximumPrice',
  'purchaseCount',
  'validUntil',
  'outsideRules',
];

/** Deterministic list of what a draft still needs, in asking order. Shared by API and console. */
export function mandateChatMissingFields(draft: MandateChatDraft): MandateChatMissingField[] {
  if (!draft.category) return ['category'];
  const missing: MandateChatMissingField[] = [];
  if (!draft.origin) missing.push('origin');
  if (!draft.destination) missing.push('destination');
  if (!draft.departureDateFrom || !draft.departureDateTo) missing.push('departureDates');
  if (!draft.passengerCount) missing.push('passengerCount');
  if (!draft.maxPerPurchaseMinor || !draft.currency) missing.push('maximumPrice');
  if (!draft.maxFulfillments) missing.push('purchaseCount');
  if (!draft.validUntil) missing.push('validUntil');
  if (!draft.escalation) missing.push('outsideRules');
  return missing;
}

/**
 * Tap-to-answer suggestions for the next missing field. Plain sentences the person could have
 * typed, so the interpreter treats them exactly like typed input — no hidden code path.
 */
export function mandateChatSuggestions(
  draft: MandateChatDraft | null,
  options: { signedPlan?: boolean } = {},
): string[] {
  if (options.signedPlan)
    return ['What are you doing right now?', 'What happens if the price goes up?'];
  const next = draft ? mandateChatMissingFields(draft)[0] : 'category';
  switch (next) {
    case 'category':
    case 'origin':
      return ['A flight from Caracas', 'A flight from Bogotá', 'A flight from Buenos Aires'];
    case 'destination':
      return ['To Córdoba', 'To Madrid', 'To Miami'];
    case 'departureDates':
      return ['Next month', 'Next week', 'Any date in the next 60 days'];
    case 'passengerCount':
      return ['Just me', '2 passengers'];
    case 'maximumPrice':
      return ['Max $150 all-in', 'Max $300 all-in', 'Max $500 all-in'];
    case 'purchaseCount':
      return ['One purchase only', 'Up to 2 purchases'];
    case 'validUntil':
      return ['Valid until the end of the month', 'Valid for the next 14 days'];
    case 'outsideRules':
      return ['Ask me first', 'Block anything outside the rules'];
    default:
      return ['Looks good, I will review the plan', 'Change the maximum to $200'];
  }
}

export const MandateChatResponseSchema = MandateChatModelOutputSchema.extend({
  interpreter: z.enum(['openai', 'scripted']),
});
export type MandateChatResponse = z.infer<typeof MandateChatResponseSchema>;
