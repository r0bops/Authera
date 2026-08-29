import { PurchaseAttemptResponseSchema } from '@agentcerta/contracts';
import { z } from 'zod';

export const SearchFlightsInputSchema = z.strictObject({
  origin: z.string().regex(/^[A-Z]{3}$/),
  destination: z.string().regex(/^[A-Z]{3}$/),
  departureDateFrom: z.iso.date(),
  departureDateTo: z.iso.date(),
});
export type SearchFlightsInput = z.infer<typeof SearchFlightsInputSchema>;

/** The model may select identifiers only. The gateway reloads every authoritative value. */
export const RequestPurchaseToolInputSchema = z.strictObject({
  mandateId: z.uuid(),
  offerId: z.uuid(),
  checkoutId: z.uuid(),
});
export type RequestPurchaseToolInput = z.infer<typeof RequestPurchaseToolInputSchema>;

export const AgentOfferSchema = z.strictObject({
  offerId: z.uuid(),
  checkoutId: z.uuid(),
  origin: z.string().regex(/^[A-Z]{3}$/),
  destination: z.string().regex(/^[A-Z]{3}$/),
  departureAt: z.iso.datetime(),
  totalMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  displaySummary: z.string().min(1).max(280),
});
export type AgentOffer = z.infer<typeof AgentOfferSchema>;

export const FlightSearchResultSchema = z.strictObject({
  offers: z.array(AgentOfferSchema).max(100),
});
export type FlightSearchResult = z.infer<typeof FlightSearchResultSchema>;

export const PurchasingTaskSchema = SearchFlightsInputSchema.extend({
  mandateId: z.uuid(),
  maxAmountMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type PurchasingTask = z.infer<typeof PurchasingTaskSchema>;

export const AgentRunOutcomeSchema = z.enum(['PURCHASE_REQUESTED', 'NO_MATCH']);
export type AgentRunOutcome = z.infer<typeof AgentRunOutcomeSchema>;

export const AgentRunResultSchema = z.strictObject({
  requestedMode: z.enum(['scripted', 'openai']),
  executedMode: z.enum(['scripted', 'openai']),
  fallbackUsed: z.boolean(),
  outcome: AgentRunOutcomeSchema,
  consideredOfferIds: z.array(z.uuid()),
  selectedOfferId: z.uuid().optional(),
  purchase: PurchaseAttemptResponseSchema.optional(),
});
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;
