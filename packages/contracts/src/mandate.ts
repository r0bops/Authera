import { z } from 'zod';
import { CurrencySchema, MinorUnitsSchema } from './money.js';

export const MANDATE_SCHEMA_ID = 'agentcerta.mandate.v1' as const;

export const IataCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'must be a three-letter IATA code in upper case');

/** Calendar date, YYYY-MM-DD. */
export const IsoDateSchema = z.iso.date();

export const CabinSchema = z.enum(['economy', 'premium_economy', 'business', 'first']);
export type Cabin = z.infer<typeof CabinSchema>;

export const FlightIntentSchema = z
  .strictObject({
    type: z.literal('flight'),
    origin: IataCodeSchema,
    destination: IataCodeSchema,
    cabin: z.literal('economy'),
    departureDateFrom: IsoDateSchema,
    departureDateTo: IsoDateSchema,
    passengerCount: z.number().int().min(1).max(9),
  })
  .refine((intent) => intent.departureDateFrom <= intent.departureDateTo, {
    message: 'departureDateFrom must not be after departureDateTo',
    path: ['departureDateTo'],
  })
  .refine((intent) => intent.origin !== intent.destination, {
    message: 'origin and destination must differ',
    path: ['destination'],
  });
export type FlightIntent = z.infer<typeof FlightIntentSchema>;

export const MandateLimitsSchema = z
  .strictObject({
    currency: CurrencySchema,
    maxPerPurchaseMinor: MinorUnitsSchema.min(1),
    maxTotalMinor: MinorUnitsSchema.min(1),
    maxFulfillments: z.number().int().min(1).max(100),
  })
  .refine((limits) => limits.maxPerPurchaseMinor <= limits.maxTotalMinor, {
    message: 'maxPerPurchaseMinor must not exceed maxTotalMinor',
    path: ['maxPerPurchaseMinor'],
  });
export type MandateLimits = z.infer<typeof MandateLimitsSchema>;

export const MandateEscalationSchema = z.enum(['block', 'require_human']);
export type MandateEscalation = z.infer<typeof MandateEscalationSchema>;

/**
 * The signed policy (CLAUDE_IMPLEMENTATION_SPEC.md §8). Strict: any field the evaluator
 * does not understand fails validation, and the evaluator fails closed.
 */
export const MandatePolicyV1Schema = z
  .strictObject({
    schema: z.literal(MANDATE_SCHEMA_ID),
    mandateId: z.uuid(),
    version: z.number().int().min(1),
    humanId: z.uuid(),
    agentId: z.uuid(),
    agentKeyThumbprint: z.string().min(1),
    allowedMerchantIds: z.array(z.uuid()).min(1),
    paymentMethodRef: z.string().min(1),
    intent: FlightIntentSchema,
    limits: MandateLimitsSchema,
    validFrom: z.iso.datetime(),
    validUntil: z.iso.datetime(),
    escalation: MandateEscalationSchema,
  })
  .refine((policy) => Date.parse(policy.validUntil) > Date.parse(policy.validFrom), {
    message: 'validUntil must be after validFrom',
    path: ['validUntil'],
  });
export type MandatePolicyV1 = z.infer<typeof MandatePolicyV1Schema>;

export const MandateStateSchema = z.enum(['DRAFT', 'ACTIVE', 'REVOKED', 'EXPIRED', 'SUPERSEDED']);
export type MandateState = z.infer<typeof MandateStateSchema>;
