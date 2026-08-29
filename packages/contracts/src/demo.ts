import { z } from 'zod';
import { CabinSchema, IataCodeSchema } from './mandate.js';
import { CurrencySchema } from './money.js';
import { PurchaseAttemptResponseSchema } from './execution.js';

/**
 * Demo-control API (CLAUDE_IMPLEMENTATION_SPEC.md §12). Every control drives the same
 * application services as real traffic; none can insert a successful execution.
 */

export const DemoInjectOfferRequestSchema = z.strictObject({
  /** Merchant (market) that publishes the offer. Defaults to the first seeded merchant. */
  merchantId: z.uuid().optional(),
  origin: IataCodeSchema.default('CCS'),
  destination: IataCodeSchema.default('COR'),
  cabin: CabinSchema.default('economy'),
  amountMinor: z.number().int().min(0),
  currency: CurrencySchema.default('USD'),
  departureAt: z.iso.datetime().optional(),
  passengerCount: z.number().int().min(1).max(9).default(1),
  /** Defaults to the merchant's display name. */
  airline: z.string().min(1).max(40).optional(),
  flightNumber: z.string().min(1).max(10).optional(),
  /** Minutes until the offer expires (default 24 h). */
  expiresInMinutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 30)
    .default(60 * 24),
});
export type DemoInjectOfferRequest = z.infer<typeof DemoInjectOfferRequestSchema>;

export const DemoAttemptRequestSchema = z.strictObject({
  mandateId: z.uuid(),
  /** Force a specific offer instead of letting the agent search. */
  offerId: z.uuid().optional(),
  /** Override the agent mode for this run (defaults to OPENAI_MODE). */
  mode: z.enum(['scripted', 'openai']).optional(),
});
export type DemoAttemptRequest = z.infer<typeof DemoAttemptRequestSchema>;

export const DemoDirectAttemptRequestSchema = z.strictObject({
  mandateId: z.uuid(),
  offerId: z.uuid(),
  /** Re-use an existing checkout (e.g. after an approval) instead of creating a new one. */
  checkoutId: z.uuid().optional(),
  /** Sign with a key the mandate does not authorize (impersonation demo). */
  impersonate: z.boolean().default(false),
});
export type DemoDirectAttemptRequest = z.infer<typeof DemoDirectAttemptRequestSchema>;

export const DemoReplayRequestSchema = z.strictObject({
  /** Execution id of a previous direct attempt whose signed request was captured. */
  executionId: z.uuid(),
});
export type DemoReplayRequest = z.infer<typeof DemoReplayRequestSchema>;

export const DemoConcurrentAttemptsRequestSchema = z.strictObject({
  mandateId: z.uuid(),
  offerId: z.uuid(),
  attempts: z.number().int().min(2).max(5).default(2),
});
export type DemoConcurrentAttemptsRequest = z.infer<typeof DemoConcurrentAttemptsRequestSchema>;

export const DemoTimeRequestSchema = z.strictObject({
  /** Offset applied to the server clock in demo mode; 0 clears it. */
  offsetMinutes: z
    .number()
    .int()
    .min(-60 * 24 * 365)
    .max(60 * 24 * 365),
});
export type DemoTimeRequest = z.infer<typeof DemoTimeRequestSchema>;

export const DemoPaymentBehaviorRequestSchema = z.strictObject({
  outcome: z.enum(['succeed', 'fail', 'pending']),
  failureReason: z.string().min(1).max(80).optional(),
  webhookDelayMs: z.number().int().min(0).max(60_000).optional(),
  pendingResolvesTo: z.enum(['succeed', 'fail']).optional(),
  duplicateWebhooks: z.number().int().min(0).max(5).optional(),
});
export type DemoPaymentBehaviorRequest = z.infer<typeof DemoPaymentBehaviorRequestSchema>;

export const AgentTraceEventSchema = z.object({
  at: z.iso.datetime(),
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const DemoAttemptResultSchema = z.object({
  mode: z.enum(['scripted', 'openai']),
  fallbackUsed: z.boolean(),
  outcome: z.enum(['PURCHASE_REQUESTED', 'NO_MATCH']),
  consideredOfferIds: z.array(z.uuid()),
  /** Distinct markets (ISO 3166-1 alpha-2) whose merchants returned offers. */
  marketsSearched: z.array(z.string()),
  selectedOfferId: z.uuid().optional(),
  /** Plain-language reason the agent gave for its choice (or for not choosing). */
  selectionReason: z.string().optional(),
  purchase: PurchaseAttemptResponseSchema.optional(),
  trace: z.array(AgentTraceEventSchema),
});
export type DemoAttemptResult = z.infer<typeof DemoAttemptResultSchema>;

export const DemoDirectAttemptResultSchema = z.object({
  status: z.number().int(),
  response: z.unknown(),
  purchase: PurchaseAttemptResponseSchema.optional(),
  checkoutId: z.uuid().optional(),
  signedRequest: z.object({
    method: z.string(),
    path: z.string(),
    keyid: z.string(),
    nonce: z.string(),
  }),
});
export type DemoDirectAttemptResult = z.infer<typeof DemoDirectAttemptResultSchema>;

export const DemoStateSchema = z.object({
  demoMode: z.boolean(),
  paymentMode: z.enum(['mock', 'yuno']),
  agentMode: z.enum(['scripted', 'openai']),
  clockOffsetMinutes: z.number(),
  clockEnabled: z.boolean(),
  now: z.iso.datetime(),
  paymentBehavior: DemoPaymentBehaviorRequestSchema.nullable(),
  paymentCalls: z.number().int(),
  capturedRequests: z.array(
    z.object({
      executionId: z.uuid(),
      path: z.string(),
      keyid: z.string(),
      nonce: z.string(),
      at: z.iso.datetime(),
    }),
  ),
});
export type DemoState = z.infer<typeof DemoStateSchema>;
