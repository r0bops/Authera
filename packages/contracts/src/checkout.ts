import { z } from 'zod';
import { CabinSchema, IataCodeSchema } from './mandate.js';
import { MoneySchema } from './money.js';
import { OfferStatusSchema } from './policy.js';

/** Server-owned flight offer. Price and currency are authoritative here, never in the client. */
export const OfferSchema = z.strictObject({
  id: z.uuid(),
  merchantId: z.uuid(),
  /** Denormalized from the merchant row so every view can show where the offer came from. */
  merchantName: z.string().min(1),
  /** ISO 3166-1 alpha-2 market of the selling merchant. */
  market: z.string().length(2),
  airline: z.string().min(1),
  flightNumber: z.string().min(1),
  origin: IataCodeSchema,
  destination: IataCodeSchema,
  cabin: CabinSchema,
  departureAt: z.iso.datetime(),
  arrivalAt: z.iso.datetime(),
  passengerCount: z.number().int().min(1),
  total: MoneySchema,
  status: OfferStatusSchema,
  expiresAt: z.iso.datetime(),
  source: z.enum(['seed', 'demo']),
  createdAt: z.iso.datetime(),
});
export type Offer = z.infer<typeof OfferSchema>;

export const CART_SCHEMA_ID = 'authera.cart.v1' as const;

export const CartLineItemSchema = z.strictObject({
  offerId: z.uuid(),
  description: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPrice: MoneySchema,
});

/** Canonical merchant cart. Its RFC 8785 hash binds approvals and evidence to this exact content. */
export const CheckoutCartSchema = z.strictObject({
  schema: z.literal(CART_SCHEMA_ID),
  merchantId: z.uuid(),
  offerId: z.uuid(),
  lineItems: z.array(CartLineItemSchema).min(1),
  total: MoneySchema,
});
export type CheckoutCart = z.infer<typeof CheckoutCartSchema>;

export const CheckoutStatusSchema = z.enum(['OPEN', 'COMPLETED', 'EXPIRED', 'CANCELLED']);
export type CheckoutStatus = z.infer<typeof CheckoutStatusSchema>;

export const CheckoutSchema = z.strictObject({
  id: z.uuid(),
  offerId: z.uuid(),
  merchantId: z.uuid(),
  cart: CheckoutCartSchema,
  cartHash: z.string().min(1),
  total: MoneySchema,
  status: CheckoutStatusSchema,
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Checkout = z.infer<typeof CheckoutSchema>;
