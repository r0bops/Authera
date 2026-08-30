import { z } from 'zod';
import { CurrencySchema, MinorUnitsSchema } from './money.js';

export const MANDATE_SCHEMA_ID = 'authera.mandate.v1' as const;

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
    /** Calendar days before/after the preferred window that may be searched and purchased. */
    dateFlexibilityDays: z.number().int().min(0).max(30).optional(),
    passengerCount: z.number().int().min(1).max(9),
    /** Optional departure-time window, local time at the origin airport (HH:mm, inclusive). */
    departureTimeFrom: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    departureTimeTo: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  })
  .refine(
    (intent) =>
      (intent.departureTimeFrom === undefined) === (intent.departureTimeTo === undefined) &&
      (intent.departureTimeFrom === undefined ||
        intent.departureTimeFrom <= intent.departureTimeTo!),
    {
      message: 'departureTimeFrom and departureTimeTo must be set together, from ≤ to',
      path: ['departureTimeTo'],
    },
  )
  .refine((intent) => intent.departureDateFrom <= intent.departureDateTo, {
    message: 'departureDateFrom must not be after departureDateTo',
    path: ['departureDateTo'],
  })
  .refine((intent) => intent.origin !== intent.destination, {
    message: 'origin and destination must differ',
    path: ['destination'],
  });
export type FlightIntent = z.infer<typeof FlightIntentSchema>;

/** Shift a YYYY-MM-DD calendar date without depending on the host timezone. */
export function shiftIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}

/** The date window both market discovery and deterministic policy enforcement must use. */
/** Departure local time (HH:mm) of an offer whose `departureAt` carries the airport's wall time. */
export function departureLocalTime(departureAtIso: string): string {
  return departureAtIso.slice(11, 16);
}

/** True when the intent has no time window, or the offer departs inside it (inclusive). */
export function departureTimeAllowed(intent: FlightIntent, departureAtIso: string): boolean {
  if (!intent.departureTimeFrom || !intent.departureTimeTo) return true;
  const hhmm = departureLocalTime(departureAtIso);
  return hhmm >= intent.departureTimeFrom && hhmm <= intent.departureTimeTo;
}

export function effectiveFlightDateWindow(intent: FlightIntent): { from: string; to: string } {
  const flexibilityDays = intent.dateFlexibilityDays ?? 0;
  return {
    from: shiftIsoDate(intent.departureDateFrom, -flexibilityDays),
    to: shiftIsoDate(intent.departureDateTo, flexibilityDays),
  };
}

/**
 * Marketplace purchase: "buy me <query>". The agent may only request an offer that was
 * discovered under exactly this query, at most `maxQuantity` units, within the money limits.
 */
export const GoodsIntentSchema = z.strictObject({
  type: z.literal('goods'),
  query: z.string().trim().min(2).max(80),
  maxQuantity: z.number().int().min(1).max(10),
});
export type GoodsIntent = z.infer<typeof GoodsIntentSchema>;

export const IntentSchema = z.discriminatedUnion('type', [FlightIntentSchema, GoodsIntentSchema]);
export type Intent = z.infer<typeof IntentSchema>;
export type IntentType = Intent['type'];

/** Short human title for any intent, e.g. "CCS → COR" or "“running socks” × up to 2". */
export function intentTitle(intent: Intent): string {
  if (intent.type === 'flight') return `${intent.origin} → ${intent.destination}`;
  return intent.maxQuantity === 1
    ? `“${intent.query}”`
    : `“${intent.query}” × up to ${intent.maxQuantity}`;
}

/** Normalized form used when comparing a stored offer's search query with a mandate's query. */
export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export const MandateLimitsSchema = z
  .strictObject({
    currency: CurrencySchema,
    maxPerPurchaseMinor: MinorUnitsSchema.min(1),
    maxTotalMinor: MinorUnitsSchema.min(1),
    maxFulfillments: z.number().int().min(1).max(100),
    /**
     * Rich condition for `require_human` plans: a purchase above the per-purchase limit but at
     * or under this amount waits for the human; anything above it is blocked outright, no
     * matter what anyone approves. Absent = any overage may be escalated (legacy behaviour).
     */
    approvalCeilingMinor: MinorUnitsSchema.min(1).optional(),
  })
  .refine((limits) => limits.maxPerPurchaseMinor <= limits.maxTotalMinor, {
    message: 'maxPerPurchaseMinor must not exceed maxTotalMinor',
    path: ['maxPerPurchaseMinor'],
  })
  .refine(
    (limits) =>
      limits.approvalCeilingMinor === undefined ||
      limits.approvalCeilingMinor >= limits.maxPerPurchaseMinor,
    {
      message: 'approvalCeilingMinor must be at least maxPerPurchaseMinor',
      path: ['approvalCeilingMinor'],
    },
  );
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
    intent: IntentSchema,
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
