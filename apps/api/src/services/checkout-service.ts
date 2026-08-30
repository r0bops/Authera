import { randomUUID } from 'node:crypto';
import type {
  Checkout,
  CheckoutCart,
  CheckoutSession,
  FlightOfferView,
  FlightSearchQuery,
  Offer,
  ProductSearchQuery,
} from '@authera/contracts';
import { normalizeQuery } from '@authera/contracts';
import { UCP_PINNED_VERSION } from '@authera/contracts';
import {
  applyRevalidation,
  createCheckout,
  getCheckout,
  getOffer,
  listOffers,
  syncProviderOffers,
  type Database,
} from '@authera/db';
import { formatMoney, hashCanonical } from '@authera/domain';
import type { Clock } from '../clock.js';
import { ApiProblem } from '../http/problem.js';
import type { Logger } from '../logger.js';
import type { FlightMarketProvider } from './flight-market/provider.js';
import type { GoodsMarketProvider } from './goods-market/shopify-provider.js';

const MARKET_SEARCH_TIMEOUT_MS = 8_000;

const CHECKOUT_TTL_MS = 2 * 60 * 60 * 1000;

export function offerSummary(offer: Offer): string {
  if (offer.kind === 'goods') {
    const qty = offer.quantity === 1 ? '' : ` · ×${offer.quantity}`;
    return `${offer.merchantName} (${offer.market}) · ${offer.title ?? 'product'}${qty} · ${formatMoney(offer.total)}`;
  }
  const departure = (offer.departureAt ?? '').slice(0, 16).replace('T', ' ');
  return `${offer.merchantName} (${offer.market}) · ${offer.airline ?? ''} ${offer.flightNumber ?? ''} · ${offer.origin ?? '?'}→${offer.destination ?? '?'} · ${departure} · ${offer.cabin ?? ''} · ${formatMoney(offer.total)}`;
}

export function toOfferView(offer: Offer): FlightOfferView {
  return { ...offer, summary: offerSummary(offer) };
}

/**
 * Merchant-side catalog and checkout sessions. Prices are only ever read from storage: live
 * markets are queried during discovery and their offers stored first, then read back like any
 * seeded offer, so the gateway never sees a provider payload.
 */
export class CheckoutService {
  constructor(
    private readonly deps: {
      db: Database;
      clock: Clock;
      markets?: FlightMarketProvider[];
      goodsMarkets?: GoodsMarketProvider[];
      logger?: Logger;
    },
  ) {}

  /** Query every configured live market and store what came back. Failures never block search. */
  private async refreshLiveMarkets(query: FlightSearchQuery): Promise<void> {
    const markets = this.deps.markets ?? [];
    if (markets.length === 0) return;
    await Promise.all(
      markets.map(async (market) => {
        const started = Date.now();
        try {
          const found = await market.search(query, {
            signal: AbortSignal.timeout(MARKET_SEARCH_TIMEOUT_MS),
          });
          await syncProviderOffers(this.deps.db, {
            source: market.source,
            merchantId: market.merchantId,
            scope: { kind: 'flight', origin: query.origin, destination: query.destination },
            offers: found.map((o) => ({ id: randomUUID(), ...o })),
          });
          this.deps.logger?.info(
            { market: market.source, offers: found.length, durationMs: Date.now() - started },
            'live market searched',
          );
        } catch (error) {
          this.deps.logger?.warn(
            { err: error, market: market.source, durationMs: Date.now() - started },
            'live market unavailable; continuing with stored offers',
          );
        }
      }),
    );
  }

  /** Query every configured goods market for one search string and store what came back. */
  private async refreshGoodsMarkets(query: ProductSearchQuery): Promise<void> {
    const markets = this.deps.goodsMarkets ?? [];
    if (markets.length === 0) return;
    const searchQuery = normalizeQuery(query.q);
    await Promise.all(
      markets.map(async (market) => {
        const started = Date.now();
        try {
          const found = await market.search(
            { ...query, q: searchQuery },
            { signal: AbortSignal.timeout(MARKET_SEARCH_TIMEOUT_MS) },
          );
          await syncProviderOffers(this.deps.db, {
            source: market.source,
            merchantId: market.merchantId,
            scope: { kind: 'goods', searchQuery },
            offers: found.map((p) => ({
              id: randomUUID(),
              providerOfferId: p.providerOfferId,
              title: p.title,
              airline: p.vendor,
              quantity: p.quantity,
              ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
              amountMinor: p.amountMinor,
              currency: p.currency,
              expiresAt: p.expiresAt,
            })),
          });
          this.deps.logger?.info(
            { market: market.source, offers: found.length, durationMs: Date.now() - started },
            'goods market searched',
          );
        } catch (error) {
          this.deps.logger?.warn(
            { err: error, market: market.source, durationMs: Date.now() - started },
            'goods market unavailable; continuing with stored offers',
          );
        }
      }),
    );
  }

  /** Marketplace discovery: live storefront search stored server-side, then read back. */
  async searchProducts(query: ProductSearchQuery): Promise<FlightOfferView[]> {
    await this.refreshGoodsMarkets(query);
    const now = this.deps.clock.now();
    const offers = await listOffers(this.deps.db, {
      kind: 'goods',
      searchQuery: normalizeQuery(query.q),
      status: 'AVAILABLE',
    });
    return offers
      .filter((o) => Date.parse(o.expiresAt) > now.getTime())
      .slice(0, query.limit ?? 20)
      .map(toOfferView);
  }

  async searchFlights(query: FlightSearchQuery): Promise<FlightOfferView[]> {
    await this.refreshLiveMarkets(query);
    const now = this.deps.clock.now();
    const offers = await listOffers(this.deps.db, {
      kind: 'flight',
      origin: query.origin,
      destination: query.destination,
      status: 'AVAILABLE',
      ...(query.from ? { departureFrom: new Date(`${query.from}T00:00:00.000Z`) } : {}),
      ...(query.to ? { departureTo: new Date(`${query.to}T23:59:59.999Z`) } : {}),
    });
    return offers
      .filter((o) => Date.parse(o.expiresAt) > now.getTime())
      .filter((o) => query.passengers === undefined || o.passengerCount === query.passengers)
      .map(toOfferView);
  }

  /** The console catalog: only offers that are still AVAILABLE (superseded live rows stay as history). */
  async listCatalog(): Promise<FlightOfferView[]> {
    const now = this.deps.clock.now();
    const offers = await listOffers(this.deps.db, { status: 'AVAILABLE' });
    return offers.filter((o) => Date.parse(o.expiresAt) > now.getTime()).map(toOfferView);
  }

  /** Live offers are re-priced with the provider right before a checkout binds their cart. */
  private async revalidateLiveOffer(offer: Offer): Promise<Offer> {
    if (!offer.providerOfferId) return offer;
    const market =
      (this.deps.markets ?? []).find((m) => m.source === offer.source) ??
      (this.deps.goodsMarkets ?? []).find((m) => m.source === offer.source);
    if (!market) return offer;
    let result;
    try {
      result = await market.revalidate(offer.providerOfferId, {
        signal: AbortSignal.timeout(MARKET_SEARCH_TIMEOUT_MS),
      });
    } catch (error) {
      this.deps.logger?.warn({ err: error, offerId: offer.id }, 'live offer revalidation failed');
      throw ApiProblem.conflict(
        'OFFER_NOT_AVAILABLE',
        'The live offer could not be revalidated with its market',
      );
    }
    const updated = await applyRevalidation(this.deps.db, offer.id, result);
    if (!updated || !result.available) {
      throw ApiProblem.conflict('OFFER_NOT_AVAILABLE', 'The live offer is no longer available');
    }
    if (
      updated.total.minor !== offer.total.minor ||
      updated.total.currency !== offer.total.currency
    ) {
      this.deps.logger?.info(
        { offerId: offer.id, before: offer.total, after: updated.total },
        'live offer re-priced on revalidation',
      );
    }
    return updated;
  }

  async createSession(input: { offerId: string }): Promise<CheckoutSession> {
    const now = this.deps.clock.now();
    const stored = await getOffer(this.deps.db, input.offerId);
    if (!stored) throw ApiProblem.notFound('offer');
    if (stored.status !== 'AVAILABLE' || Date.parse(stored.expiresAt) <= now.getTime()) {
      throw ApiProblem.conflict('OFFER_NOT_AVAILABLE', 'The offer is no longer available');
    }
    const offer = await this.revalidateLiveOffer(stored);
    const cart: CheckoutCart = {
      schema: 'authera.cart.v1',
      merchantId: offer.merchantId,
      offerId: offer.id,
      lineItems: [
        {
          offerId: offer.id,
          description: offerSummary(offer),
          quantity: offer.quantity,
          unitPrice: {
            currency: offer.total.currency,
            minor: Math.round(offer.total.minor / offer.quantity),
          },
        },
      ],
      total: offer.total,
    };
    const checkout = await createCheckout(this.deps.db, {
      id: randomUUID(),
      offerId: offer.id,
      merchantId: offer.merchantId,
      cart,
      cartHash: hashCanonical(cart),
      amountMinor: offer.total.minor,
      currency: offer.total.currency,
      expiresAt: new Date(Math.min(Date.parse(offer.expiresAt), now.getTime() + CHECKOUT_TTL_MS)),
    });
    return this.toSession(checkout, offer);
  }

  async getSession(id: string): Promise<CheckoutSession | undefined> {
    const checkout = await getCheckout(this.deps.db, id);
    if (!checkout) return undefined;
    const offer = await getOffer(this.deps.db, checkout.offerId);
    if (!offer) return undefined;
    return this.toSession(checkout, offer);
  }

  toSession(checkout: Checkout, offer: Offer): CheckoutSession {
    return {
      id: checkout.id,
      ucpVersion: UCP_PINNED_VERSION,
      merchantId: checkout.merchantId,
      offerId: checkout.offerId,
      status: checkout.status,
      cart: checkout.cart,
      cartHash: checkout.cartHash,
      total: checkout.total,
      expiresAt: checkout.expiresAt,
      createdAt: checkout.createdAt,
      updatedAt: checkout.updatedAt,
      offer: toOfferView(offer),
    };
  }
}
