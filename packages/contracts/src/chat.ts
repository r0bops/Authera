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
  departureTimeFrom: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  departureTimeTo: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  maxDurationMinutes: z.number().int().min(30).max(4320).nullable(),
  maxStops: z.number().int().min(0).max(3).nullable(),
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

/**
 * What the MODEL may return for the draft: the same keys, but lenient — a model that writes ""
 * for a time it does not know, or 0 for a limit that was not given, must not sink the whole
 * reply. Code sanitizes this into `MandateChatDraftSchema`; the strict shape is what we store.
 */
export const MandateChatModelDraftSchema = z.strictObject({
  category: z.string().nullable().describe('"flight" once the person wants a flight; else null'),
  origin: z.string().nullable().describe('IATA airport code, e.g. CCS'),
  destination: z.string().nullable().describe('IATA airport code, e.g. COR'),
  departureDateFrom: z.string().nullable().describe('YYYY-MM-DD'),
  departureDateTo: z.string().nullable().describe('YYYY-MM-DD'),
  dateFlexibilityDays: z.number().nullable().describe('integer days, usually 0'),
  departureTimeFrom: z.string().nullable().describe('HH:mm 24-hour local time, only if stated'),
  departureTimeTo: z.string().nullable().describe('HH:mm 24-hour local time, only if stated'),
  maxDurationMinutes: z.number().nullable().describe('integer minutes, only if stated'),
  maxStops: z.number().nullable().describe('0 = direct only; only if stated'),
  passengerCount: z.number().nullable().describe('integer 1-9'),
  maxPerPurchaseMinor: z.number().nullable().describe('integer minor units: USD 150 = 15000'),
  currency: z.string().nullable().describe('ISO 4217 code, e.g. USD'),
  maxFulfillments: z.number().nullable().describe('integer purchases allowed, usually 1'),
  validUntil: z
    .string()
    .nullable()
    .describe('ISO 8601 datetime when the authorization expires, e.g. 2026-09-30T23:59:59Z'),
  escalation: z.string().nullable().describe('"block" or "require_human"; null until stated'),
});
export type MandateChatModelDraft = z.infer<typeof MandateChatModelDraftSchema>;

export const MandateChatModelOutputSchema = z.strictObject({
  reply: z.string().trim().min(1).max(500),
  draft: MandateChatModelDraftSchema,
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
    return [
      'What are the fares right now?',
      'Change my maximum to $250',
      'What happens if the price goes up?',
    ];
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
      return ['What are the fares right now?', 'Max $150 all-in', 'Max $300 all-in'];
    case 'purchaseCount':
      return ['One purchase only', 'Up to 2 purchases'];
    case 'validUntil':
      return ['Valid until the end of the month', 'Valid for the next 14 days'];
    case 'outsideRules':
      return ['Ask me first', 'Block anything outside the rules (near misses still ask me)'];
    default:
      return ['Looks good, I will review the plan', 'Change the maximum to $200'];
  }
}

export const MandateChatResponseSchema = MandateChatModelOutputSchema.extend({
  /** Stored/returned drafts are always the strict shape; only the model's raw draft is lenient. */
  draft: MandateChatDraftSchema,
  interpreter: z.enum(['openai', 'scripted']),
});
export type MandateChatResponse = z.infer<typeof MandateChatResponseSchema>;
