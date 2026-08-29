import { PurchaseAttemptResponseSchema } from '@authera/contracts';
import { z } from 'zod';

export const SearchFlightsInputSchema = z.strictObject({
  origin: z.string().regex(/^[A-Z]{3}$/),
  destination: z.string().regex(/^[A-Z]{3}$/),
  departureDateFrom: z.iso.date(),
  departureDateTo: z.iso.date(),
});
export type SearchFlightsInput = z.infer<typeof SearchFlightsInputSchema>;

export const SearchProductsInputSchema = z.strictObject({
  query: z.string().trim().min(2).max(80),
});
export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;

/** The model may select identifiers only. The gateway reloads every authoritative value. */
export const RequestPurchaseToolInputSchema = z.strictObject({
  mandateId: z.uuid(),
  offerId: z.uuid(),
  checkoutId: z.uuid(),
});
export type RequestPurchaseToolInput = z.infer<typeof RequestPurchaseToolInputSchema>;

/** What the model calls: identifiers plus a short justification that never reaches the gateway. */
export const RequestPurchaseToolCallSchema = RequestPurchaseToolInputSchema.extend({
  reason: z.string().min(1).max(280),
});
export type RequestPurchaseToolCall = z.infer<typeof RequestPurchaseToolCallSchema>;

export const AgentOfferSchema = z.strictObject({
  offerId: z.uuid(),
  checkoutId: z.uuid(),
  kind: z.enum(['flight', 'goods']).default('flight'),
  merchantId: z.uuid(),
  merchantName: z.string().min(1),
  /** ISO 3166-1 alpha-2 market of the selling merchant. */
  market: z.string().length(2),
  origin: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  destination: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  departureAt: z.iso.datetime().optional(),
  /** Goods: product title and quantity. */
  title: z.string().min(1).optional(),
  quantity: z.number().int().min(1).default(1),
  totalMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  displaySummary: z.string().min(1).max(280),
});
export type AgentOffer = z.infer<typeof AgentOfferSchema>;

export const FlightSearchResultSchema = z.strictObject({
  offers: z.array(AgentOfferSchema).max(100),
});
export type FlightSearchResult = z.infer<typeof FlightSearchResultSchema>;

const TaskLimitsSchema = z.strictObject({
  mandateId: z.uuid(),
  maxAmountMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

export const FlightPurchasingTaskSchema = SearchFlightsInputSchema.extend({
  kind: z.literal('flight').default('flight'),
  ...TaskLimitsSchema.shape,
});
export const GoodsPurchasingTaskSchema = SearchProductsInputSchema.extend({
  kind: z.literal('goods'),
  maxQuantity: z.number().int().min(1).max(10),
  ...TaskLimitsSchema.shape,
});
export const PurchasingTaskSchema = z.union([
  FlightPurchasingTaskSchema,
  GoodsPurchasingTaskSchema,
]);
export type PurchasingTask = z.infer<typeof PurchasingTaskSchema>;
export type FlightPurchasingTask = z.infer<typeof FlightPurchasingTaskSchema>;
export type GoodsPurchasingTask = z.infer<typeof GoodsPurchasingTaskSchema>;

export const AgentRunOutcomeSchema = z.enum(['PURCHASE_REQUESTED', 'NO_MATCH']);
export type AgentRunOutcome = z.infer<typeof AgentRunOutcomeSchema>;

export const AgentRunResultSchema = z.strictObject({
  requestedMode: z.enum(['scripted', 'openai']),
  executedMode: z.enum(['scripted', 'openai']),
  fallbackUsed: z.boolean(),
  outcome: AgentRunOutcomeSchema,
  consideredOfferIds: z.array(z.uuid()),
  /** Distinct markets whose merchants returned offers, in first-seen order. */
  marketsSearched: z.array(z.string()),
  selectedOfferId: z.uuid().optional(),
  /** Plain-language reason for the selection (or for finding no match). */
  selectionReason: z.string().optional(),
  purchase: PurchaseAttemptResponseSchema.optional(),
});

export function marketsOf(offers: readonly { market: string }[]): string[] {
  return [...new Set(offers.map((offer) => offer.market))];
}
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;
