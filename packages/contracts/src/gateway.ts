import { z } from 'zod';
import { AuditEventSchema } from './audit.js';
import { CheckoutCartSchema, CheckoutStatusSchema, OfferSchema } from './checkout.js';
import { ExecutionStateSchema } from './execution.js';
import { IataCodeSchema, IsoDateSchema, MandateStateSchema } from './mandate.js';
import { MoneySchema } from './money.js';
import { PaymentProviderSchema, PaymentStateSchema } from './payment.js';
import { DecisionSchema, PolicyCheckSchema, ReasonCodeSchema } from './policy.js';

export const UCP_PINNED_VERSION = '2026-04-08' as const;

export const FlightSearchQuerySchema = z.strictObject({
  origin: IataCodeSchema,
  destination: IataCodeSchema,
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  passengers: z.coerce.number().int().min(1).max(9).optional(),
});
export type FlightSearchQuery = z.infer<typeof FlightSearchQuerySchema>;

export const ProductSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type ProductSearchQuery = z.infer<typeof ProductSearchQuerySchema>;

/** Offer plus a display line; price and currency remain server-owned. */
export const FlightOfferViewSchema = OfferSchema.extend({ summary: z.string() });
export type FlightOfferView = z.infer<typeof FlightOfferViewSchema>;

export const CreateCheckoutSessionRequestSchema = z.strictObject({ offerId: z.uuid() });
export type CreateCheckoutSessionRequest = z.infer<typeof CreateCheckoutSessionRequestSchema>;

export const CheckoutSessionSchema = z.object({
  id: z.uuid(),
  ucpVersion: z.literal(UCP_PINNED_VERSION),
  merchantId: z.uuid(),
  offerId: z.uuid(),
  status: CheckoutStatusSchema,
  cart: CheckoutCartSchema,
  cartHash: z.string(),
  total: MoneySchema,
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  offer: FlightOfferViewSchema,
});
export type CheckoutSession = z.infer<typeof CheckoutSessionSchema>;

export const PaymentViewSchema = z.object({
  id: z.uuid(),
  provider: PaymentProviderSchema,
  state: PaymentStateSchema,
  providerPaymentId: z.string().nullable(),
  providerTransactionId: z.string().nullable(),
  failureReason: z.string().nullable(),
  amount: MoneySchema,
  updatedAt: z.iso.datetime(),
});
export type PaymentView = z.infer<typeof PaymentViewSchema>;

export const BookingStateSchema = z.enum(['PENDING', 'BOOKED', 'FAILED', 'CANCELLED']);
export type BookingState = z.infer<typeof BookingStateSchema>;

export const BookingViewSchema = z.object({
  id: z.uuid(),
  provider: z.literal('duffel'),
  state: BookingStateSchema,
  providerOrderId: z.string().nullable(),
  bookingReference: z.string().nullable(),
  liveMode: z.boolean().nullable(),
  documents: z.array(z.object({ type: z.string(), uniqueIdentifier: z.string().nullable() })),
  failureReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type BookingView = z.infer<typeof BookingViewSchema>;

export const ExecutionViewSchema = z.object({
  id: z.uuid(),
  state: ExecutionStateSchema,
  decision: DecisionSchema.nullable(),
  reasonCode: ReasonCodeSchema.nullable(),
  explanation: z.string().nullable(),
  mandateId: z.uuid().nullable(),
  mandateVersion: z.number().int().nullable(),
  offerId: z.uuid().nullable(),
  checkoutId: z.uuid().nullable(),
  agentId: z.uuid().nullable(),
  amount: MoneySchema.nullable(),
  checklist: z.array(PolicyCheckSchema),
  approvalRequestId: z.uuid().nullable(),
  payment: PaymentViewSchema.nullable(),
  booking: BookingViewSchema.nullable(),
  reservationState: z.string().nullable(),
  evidenceId: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  timeline: z.array(AuditEventSchema),
});
export type ExecutionView = z.infer<typeof ExecutionViewSchema>;

/** Merchant-readable verification result (spec §12 `GET /api/verification/:executionId`). */
export const VerificationViewSchema = z.object({
  executionId: z.uuid(),
  evidenceId: z.string(),
  state: ExecutionStateSchema,
  decision: DecisionSchema.nullable(),
  reasonCode: ReasonCodeSchema.nullable(),
  explanation: z.string().nullable(),
  agentIdentity: z.object({
    ok: z.boolean(),
    agentId: z.uuid().nullable(),
    keyThumbprint: z.string().nullable(),
    profileUri: z.string().nullable(),
    nonce: z.string().nullable(),
    requestDigest: z.string().nullable(),
  }),
  mandate: z
    .object({
      id: z.uuid(),
      version: z.number().int(),
      status: MandateStateSchema,
      signatureKid: z.string(),
      policyHash: z.string(),
      validFrom: z.iso.datetime(),
      validUntil: z.iso.datetime(),
    })
    .nullable(),
  policyChecks: z.array(PolicyCheckSchema),
  checkout: z
    .object({
      id: z.uuid(),
      cartHash: z.string(),
      computedHash: z.string(),
      bound: z.boolean(),
      total: MoneySchema,
      status: CheckoutStatusSchema,
    })
    .nullable(),
  reservation: z.object({ state: z.string(), amount: MoneySchema }).nullable(),
  payment: PaymentViewSchema.nullable(),
  booking: BookingViewSchema.nullable(),
});
export type VerificationView = z.infer<typeof VerificationViewSchema>;

/** Compact execution row for lists (agent activity, purchases, merchant picker). */
export const ExecutionSummarySchema = z.object({
  id: z.uuid(),
  state: ExecutionStateSchema,
  decision: DecisionSchema.nullable(),
  reasonCode: ReasonCodeSchema.nullable(),
  explanation: z.string().nullable(),
  mandateId: z.uuid().nullable(),
  mandateVersion: z.number().int().nullable(),
  offerId: z.uuid().nullable(),
  offerSummary: z.string().nullable(),
  checkoutId: z.uuid().nullable(),
  amount: MoneySchema.nullable(),
  paymentState: PaymentStateSchema.nullable(),
  bookingState: BookingStateSchema.nullable(),
  approvalRequestId: z.uuid().nullable(),
  evidenceId: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;

export const ExecutionListQuerySchema = z.strictObject({
  mandateId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const AuditQuerySchema = z.strictObject({
  mandateId: z.uuid().optional(),
  executionId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

/** Marta's receipt: the execution plus the offer, the mandate it used, and a verification checklist. */
export const PurchaseReceiptSchema = z.object({
  execution: ExecutionViewSchema,
  offer: FlightOfferViewSchema.nullable(),
  mandate: z
    .object({
      id: z.uuid(),
      version: z.number().int(),
      status: MandateStateSchema,
      summary: z.string(),
      maxPerPurchase: MoneySchema,
      validUntil: z.iso.datetime(),
      agentDisplayName: z.string(),
      paymentMethodLabel: z.string().nullable(),
    })
    .nullable(),
  verification: z.array(
    z.object({ label: z.string(), ok: z.boolean(), detail: z.string().nullable() }),
  ),
  booking: BookingViewSchema.nullable(),
});
export type PurchaseReceipt = z.infer<typeof PurchaseReceiptSchema>;
