import { and, asc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import type {
  Cabin,
  Checkout,
  CheckoutCart,
  CheckoutStatus,
  Currency,
  Offer,
  OfferStatus,
} from '@authera/contracts';
import type { DbExecutor } from '../client.js';
import { checkouts, merchants, offers } from '../schema.js';

export type OfferRow = typeof offers.$inferSelect;
export type CheckoutRow = typeof checkouts.$inferSelect;
/** Offer row joined with the merchant it belongs to. */
export type OfferWithMerchantRow = { offer: OfferRow; merchantName: string; market: string };

export function toOffer({ offer: row, merchantName, market }: OfferWithMerchantRow): Offer {
  const opt = <T>(value: T | null): T | undefined => (value === null ? undefined : value);
  return {
    id: row.id,
    kind: row.kind as Offer['kind'],
    merchantId: row.merchantId,
    merchantName,
    market,
    airline: opt(row.airline),
    flightNumber: opt(row.flightNumber),
    origin: opt(row.origin),
    destination: opt(row.destination),
    cabin: opt(row.cabin as Cabin | null),
    departureAt: row.departureAt?.toISOString(),
    arrivalAt: row.arrivalAt?.toISOString(),
    passengerCount: opt(row.passengerCount),
    title: opt(row.title),
    quantity: row.quantity,
    imageUrl: opt(row.imageUrl),
    searchQuery: opt(row.searchQuery),
    total: { currency: row.currency as Currency, minor: row.amountMinor },
    status: row.status as OfferStatus,
    expiresAt: row.expiresAt.toISOString(),
    source: row.source as Offer['source'],
    ...(row.providerOfferId ? { providerOfferId: row.providerOfferId } : {}),
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
  kind?: Offer['kind'];
  searchQuery?: string;
  merchantId?: string;
  origin?: string;
  destination?: string;
  departureFrom?: Date;
  departureTo?: Date;
  status?: OfferStatus;
}

export async function listOffers(db: DbExecutor, filter: OfferFilter = {}): Promise<Offer[]> {
  const conditions = [];
  if (filter.kind) conditions.push(eq(offers.kind, filter.kind));
  if (filter.searchQuery) conditions.push(eq(offers.searchQuery, filter.searchQuery));
  if (filter.merchantId) conditions.push(eq(offers.merchantId, filter.merchantId));
  if (filter.origin) conditions.push(eq(offers.origin, filter.origin.toUpperCase()));
  if (filter.destination) conditions.push(eq(offers.destination, filter.destination.toUpperCase()));
  if (filter.departureFrom) conditions.push(gte(offers.departureAt, filter.departureFrom));
  if (filter.departureTo) conditions.push(lte(offers.departureAt, filter.departureTo));
  if (filter.status) conditions.push(eq(offers.status, filter.status));
  const query = selectWithMerchant(db).orderBy(asc(offers.amountMinor), asc(offers.departureAt));
  const rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query;
  return rows.map(toOffer);
}

export async function getOffer(db: DbExecutor, id: string): Promise<Offer | undefined> {
  const [row] = await selectWithMerchant(db).where(eq(offers.id, id));
  return row ? toOffer(row) : undefined;
}

function selectWithMerchant(db: DbExecutor) {
  return db
    .select({ offer: offers, merchantName: merchants.displayName, market: merchants.market })
    .from(offers)
    .innerJoin(merchants, eq(merchants.id, offers.merchantId));
}

async function loadOffer(db: DbExecutor, id: string): Promise<Offer> {
  const offer = await getOffer(db, id);
  if (!offer) throw new Error(`offer ${id} not found after write`);
  return offer;
}

export interface InsertOfferInput {
  id: string;
  kind?: Offer['kind'];
  merchantId: string;
  airline?: string;
  flightNumber?: string;
  origin?: string;
  destination?: string;
  cabin?: Cabin;
  departureAt?: Date;
  arrivalAt?: Date;
  passengerCount?: number;
  title?: string;
  quantity?: number;
  imageUrl?: string;
  searchQuery?: string;
  amountMinor: number;
  currency: Currency;
  expiresAt: Date;
  source: 'seed' | 'demo' | 'duffel' | 'shopify';
  providerOfferId?: string;
  status?: OfferStatus;
}

export async function insertOffer(db: DbExecutor, input: InsertOfferInput): Promise<Offer> {
  const [row] = await db
    .insert(offers)
    .values({
      ...input,
      kind: input.kind ?? 'flight',
      origin: input.origin?.toUpperCase(),
      destination: input.destination?.toUpperCase(),
      status: input.status ?? 'AVAILABLE',
    })
    .returning();
  if (!row) throw new Error('offer insert returned no row');
  return loadOffer(db, row.id);
}

/**
 * Store a fresh batch of live offers for one merchant/route: upsert by provider id and expire
 * every AVAILABLE live offer on that route that the provider no longer returns.
 */
export type ProviderScope =
  { kind: 'flight'; origin: string; destination: string } | { kind: 'goods'; searchQuery: string };

export async function syncProviderOffers(
  db: DbExecutor,
  input: {
    source: 'duffel' | 'shopify';
    merchantId: string;
    scope: ProviderScope;
    offers: Omit<InsertOfferInput, 'source' | 'merchantId' | 'kind'>[];
  },
): Promise<void> {
  const keep = input.offers.map((o) => o.providerOfferId).filter((id): id is string => !!id);
  const scopeMatch =
    input.scope.kind === 'flight'
      ? and(
          eq(offers.origin, input.scope.origin.toUpperCase()),
          eq(offers.destination, input.scope.destination.toUpperCase()),
        )
      : eq(offers.searchQuery, input.scope.searchQuery);
  const stale = and(
    eq(offers.merchantId, input.merchantId),
    eq(offers.source, input.source),
    eq(offers.kind, input.scope.kind),
    scopeMatch,
    eq(offers.status, 'AVAILABLE'),
    keep.length > 0 ? notInArray(offers.providerOfferId, keep) : sql`true`,
  );
  await db.update(offers).set({ status: 'EXPIRED' }).where(stale);
  if (input.offers.length === 0) return;
  await db
    .insert(offers)
    .values(
      input.offers.map((o) => ({
        ...o,
        kind: input.scope.kind,
        origin: o.origin?.toUpperCase(),
        destination: o.destination?.toUpperCase(),
        ...(input.scope.kind === 'goods' ? { searchQuery: input.scope.searchQuery } : {}),
        merchantId: input.merchantId,
        source: input.source,
        status: 'AVAILABLE',
      })),
    )
    .onConflictDoUpdate({
      target: [offers.source, offers.providerOfferId],
      set: {
        amountMinor: sql`excluded.amount_minor`,
        currency: sql`excluded.currency`,
        expiresAt: sql`excluded.expires_at`,
        status: 'AVAILABLE',
      },
    });
}

/** Re-price or withdraw a live offer after provider revalidation. */
export async function applyRevalidation(
  db: DbExecutor,
  id: string,
  next: { available: boolean; amountMinor?: number; currency?: Currency; expiresAt?: Date },
): Promise<Offer | undefined> {
  if (!next.available) {
    await db.update(offers).set({ status: 'EXPIRED' }).where(eq(offers.id, id));
  } else {
    await db
      .update(offers)
      .set({
        ...(next.amountMinor === undefined ? {} : { amountMinor: next.amountMinor }),
        ...(next.currency === undefined ? {} : { currency: next.currency }),
        ...(next.expiresAt === undefined ? {} : { expiresAt: next.expiresAt }),
      })
      .where(eq(offers.id, id));
  }
  return getOffer(db, id);
}

export async function listOffersByIds(db: DbExecutor, ids: string[]): Promise<Offer[]> {
  if (ids.length === 0) return [];
  const rows = await selectWithMerchant(db).where(inArray(offers.id, ids));
  return rows.map(toOffer);
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

/**
 * DEMO ONLY: overwrite the stored cart without touching `cart_hash`, simulating a cart that
 * changed after authorization. The gateway must detect it (`CHECKOUT_HASH_MISMATCH`).
 */
export async function tamperCheckoutCart(
  db: DbExecutor,
  id: string,
  cart: CheckoutCart,
): Promise<Checkout> {
  const [row] = await db
    .update(checkouts)
    .set({ cart: cart as unknown as Record<string, unknown>, updatedAt: sql`now()` })
    .where(eq(checkouts.id, id))
    .returning();
  if (!row) throw new Error(`checkout ${id} not found`);
  return toCheckout(row);
}
