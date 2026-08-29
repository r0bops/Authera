import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type {
  Cabin,
  Checkout,
  CheckoutCart,
  CheckoutStatus,
  Currency,
  Offer,
  OfferStatus,
} from '@agentcerta/contracts';
import type { DbExecutor } from '../client.js';
import { checkouts, offers } from '../schema.js';

export type OfferRow = typeof offers.$inferSelect;
export type CheckoutRow = typeof checkouts.$inferSelect;

export function toOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    merchantId: row.merchantId,
    airline: row.airline,
    flightNumber: row.flightNumber,
    origin: row.origin,
    destination: row.destination,
    cabin: row.cabin as Cabin,
    departureAt: row.departureAt.toISOString(),
    arrivalAt: row.arrivalAt.toISOString(),
    passengerCount: row.passengerCount,
    total: { currency: row.currency as Currency, minor: row.amountMinor },
    status: row.status as OfferStatus,
    expiresAt: row.expiresAt.toISOString(),
    source: row.source as Offer['source'],
    createdAt: row.createdAt.toISOString(),
  };
}

export function toCheckout(row: CheckoutRow): Checkout {
  return {
    id: row.id,
    offerId: row.offerId,
    merchantId: row.merchantId,
    cart: row.cart as unknown as CheckoutCart,
    cartHash: row.cartHash,
    total: { currency: row.currency as Currency, minor: row.amountMinor },
    status: row.status as CheckoutStatus,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface OfferFilter {
  merchantId?: string;
  origin?: string;
  destination?: string;
  departureFrom?: Date;
  departureTo?: Date;
  status?: OfferStatus;
}

export async function listOffers(db: DbExecutor, filter: OfferFilter = {}): Promise<Offer[]> {
  const conditions = [];
  if (filter.merchantId) conditions.push(eq(offers.merchantId, filter.merchantId));
  if (filter.origin) conditions.push(eq(offers.origin, filter.origin.toUpperCase()));
  if (filter.destination) conditions.push(eq(offers.destination, filter.destination.toUpperCase()));
  if (filter.departureFrom) conditions.push(gte(offers.departureAt, filter.departureFrom));
  if (filter.departureTo) conditions.push(lte(offers.departureAt, filter.departureTo));
  if (filter.status) conditions.push(eq(offers.status, filter.status));
  const query = db.select().from(offers).orderBy(asc(offers.amountMinor), asc(offers.departureAt));
  const rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query;
  return rows.map(toOffer);
}

export async function getOffer(db: DbExecutor, id: string): Promise<Offer | undefined> {
  const [row] = await db.select().from(offers).where(eq(offers.id, id));
  return row ? toOffer(row) : undefined;
}

export interface InsertOfferInput {
  id: string;
  merchantId: string;
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  cabin: Cabin;
  departureAt: Date;
  arrivalAt: Date;
  passengerCount: number;
  amountMinor: number;
  currency: Currency;
  expiresAt: Date;
  source: 'seed' | 'demo';
  status?: OfferStatus;
}

export async function insertOffer(db: DbExecutor, input: InsertOfferInput): Promise<Offer> {
  const [row] = await db
    .insert(offers)
    .values({
      ...input,
      origin: input.origin.toUpperCase(),
      destination: input.destination.toUpperCase(),
      status: input.status ?? 'AVAILABLE',
    })
    .returning();
  if (!row) throw new Error('offer insert returned no row');
  return toOffer(row);
}

export async function updateOfferStatus(
  db: DbExecutor,
  id: string,
  status: OfferStatus,
): Promise<void> {
  await db.update(offers).set({ status }).where(eq(offers.id, id));
}

export interface CreateCheckoutInput {
  id: string;
  offerId: string;
  merchantId: string;
  cart: CheckoutCart;
  cartHash: string;
  amountMinor: number;
  currency: Currency;
  expiresAt: Date;
}

export async function createCheckout(
  db: DbExecutor,
  input: CreateCheckoutInput,
): Promise<Checkout> {
  const [row] = await db
    .insert(checkouts)
    .values({ ...input, cart: input.cart as unknown as Record<string, unknown>, status: 'OPEN' })
    .returning();
  if (!row) throw new Error('checkout insert returned no row');
  return toCheckout(row);
}

export async function getCheckout(db: DbExecutor, id: string): Promise<Checkout | undefined> {
  const [row] = await db.select().from(checkouts).where(eq(checkouts.id, id));
  return row ? toCheckout(row) : undefined;
}

export async function updateCheckoutStatus(
  db: DbExecutor,
  id: string,
  status: CheckoutStatus,
): Promise<void> {
  await db
    .update(checkouts)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(checkouts.id, id));
}

/** Replace the cart (and its hash). Used to prove that a mutated cart invalidates approvals. */
export async function replaceCheckoutCart(
  db: DbExecutor,
  id: string,
  next: { cart: CheckoutCart; cartHash: string; amountMinor: number; currency: Currency },
): Promise<Checkout> {
  const [row] = await db
    .update(checkouts)
    .set({
      cart: next.cart as unknown as Record<string, unknown>,
      cartHash: next.cartHash,
      amountMinor: next.amountMinor,
      currency: next.currency,
      updatedAt: sql`now()`,
    })
    .where(eq(checkouts.id, id))
    .returning();
  if (!row) throw new Error(`checkout ${id} not found`);
  return toCheckout(row);
}
