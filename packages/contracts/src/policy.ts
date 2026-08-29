import { z } from 'zod';
import { MandatePolicyV1Schema, MandateStateSchema } from './mandate.js';
import { MoneySchema } from './money.js';

export const REASON_CODES = [
  'ALLOW_WITHIN_MANDATE',
  'ALLOW_CHECKOUT_APPROVAL',
  'REQUIRE_HUMAN_AMOUNT',
  'REQUIRE_HUMAN_CONDITION',
  'AGENT_UNKNOWN',
  'AGENT_REVOKED',
  'SIGNATURE_INVALID',
  'REQUEST_EXPIRED',
  'REPLAY_DETECTED',
  'MANDATE_INVALID',
  'MANDATE_NOT_ACTIVE',
  'MANDATE_NOT_YET_VALID',
  'MANDATE_EXPIRED',
  'MANDATE_REVOKED',
  'MANDATE_SUPERSEDED',
  'AGENT_KEY_MISMATCH',
  'MERCHANT_NOT_ALLOWED',
  'OFFER_NOT_AVAILABLE',
  'INTENT_MISMATCH',
  'AMOUNT_EXCEEDED',
  'CURRENCY_MISMATCH',
  'USAGE_EXHAUSTED',
  'CHECKOUT_EXPIRED',
  'CHECKOUT_HASH_MISMATCH',
  'APPROVAL_INVALID',
  'RESERVATION_CONFLICT',
  'PAYMENT_FAILED',
  'INTERNAL_FAIL_CLOSED',
] as const;
export const ReasonCodeSchema = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export const DecisionSchema = z.enum(['ALLOW', 'BLOCK', 'REQUIRE_HUMAN']);
export type Decision = z.infer<typeof DecisionSchema>;

export const AgentStatusSchema = z.enum(['ACTIVE', 'REVOKED']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const OfferStatusSchema = z.enum(['AVAILABLE', 'WITHDRAWN', 'EXPIRED']);
export type OfferStatus = z.infer<typeof OfferStatusSchema>;

export const ApprovalScopeStatusSchema = z.enum(['ACTIVE', 'CONSUMED', 'REVOKED']);

/**
 * Authoritative evaluator input (CLAUDE_IMPLEMENTATION_SPEC.md §8). Every value is loaded
 * from server-controlled records; the agent only ever supplied identifiers.
 *
 * Adaptation: `checkout.computedHash` is the hash the server recomputed from the stored
 * canonical cart, so the pure evaluator can prove checkout integrity without I/O.
 */
export const PolicyInputSchema = z.strictObject({
  now: z.iso.datetime(),
  agent: z.strictObject({
    id: z.uuid(),
    keyThumbprint: z.string().min(1),
    status: AgentStatusSchema,
  }),
  mandate: MandatePolicyV1Schema,
  runtime: z.strictObject({
    status: MandateStateSchema,
    reservedMinor: z.number().int().min(0),
    consumedMinor: z.number().int().min(0),
    reservedCount: z.number().int().min(0),
    consumedCount: z.number().int().min(0),
  }),
  merchant: z.strictObject({ id: z.uuid() }),
  offer: z.strictObject({
    id: z.uuid(),
    merchantId: z.uuid(),
    origin: z.string().min(1),
    destination: z.string().min(1),
    cabin: z.string().min(1),
    departureAt: z.iso.datetime(),
    passengerCount: z.number().int().min(1),
    total: MoneySchema,
    status: OfferStatusSchema,
  }),
  checkout: z.strictObject({
    id: z.uuid(),
    hash: z.string().min(1),
    computedHash: z.string().min(1),
    total: MoneySchema,
    offerId: z.uuid(),
    expiresAt: z.iso.datetime(),
  }),
  checkoutScopedApproval: z
    .strictObject({
      checkoutHash: z.string().min(1),
      expiresAt: z.iso.datetime(),
      status: ApprovalScopeStatusSchema,
    })
    .optional(),
});
export type PolicyInput = z.infer<typeof PolicyInputSchema>;

export const PolicyCheckSchema = z.object({
  code: z.string().min(1),
  passed: z.boolean(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
});
export type PolicyCheck = z.infer<typeof PolicyCheckSchema>;

export const PolicyVerdictSchema = z.object({
  decision: DecisionSchema,
  reasonCode: ReasonCodeSchema,
  evaluatedAt: z.iso.datetime(),
  checks: z.array(PolicyCheckSchema),
});
export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>;
