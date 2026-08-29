import { z } from 'zod';
import { CabinSchema, IataCodeSchema } from './mandate.js';
import { MoneySchema } from './money.js';
import { OfferStatusSchema } from './policy.js';

export const OfferKindSchema = z.enum(['flight', 'goods']);
export type OfferKind = z.infer<typeof OfferKindSchema>;

/**
 * Server-owned offer. Price and currency are authoritative here, never in the client.
 * `kind: flight` carries the flight fields; `kind: goods` carries `title`/`quantity` and was
 * discovered under `searchQuery` (the policy compares it with the mandate's query).
 */
export const OfferSchema = z.strictObject({
  id: z.uuid(),
  kind: OfferKindSchema.default('flight'),
  merchantId: z.uuid(),
  /** Denormalized from the merchant row so every view can show where the offer came from. */
  merchantName: z.string().min(1),
  /** ISO 3166-1 alpha-2 market of the selling merchant. */
  market: z.string().length(2),
  airline: z.string().min(1).optional(),
  flightNumber: z.string().min(1).optional(),
  origin: IataCodeSchema.optional(),
  destination: IataCodeSchema.optional(),
  cabin: CabinSchema.optional(),
  departureAt: z.iso.datetime().optional(),
  arrivalAt: z.iso.datetime().optional(),
  passengerCount: z.number().int().min(1).optional(),
  /** Goods: product title as the store publishes it. */
  title: z.string().min(1).optional(),
  quantity: z.number().int().min(1).default(1),
  imageUrl: z.url().optional(),
  /** Goods: the query this offer was discovered under. */
  searchQuery: z.string().min(1).optional(),
  total: MoneySchema,
  status: OfferStatusSchema,
  expiresAt: z.iso.datetime(),
  /** `duffel` / `shopify` offers are discovered live and stored server-side before any checkout. */
  source: z.enum(['seed', 'demo', 'duffel', 'shopify']),
  /** Provider-scoped id for live offers (revalidated before checkout). */
  providerOfferId: z.string().min(1).optional(),
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
