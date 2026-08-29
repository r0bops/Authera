import { randomUUID } from 'node:crypto';
import type {
  Checkout,
  CheckoutCart,
  CheckoutSession,
  FlightOfferView,
  FlightSearchQuery,
  Offer,
} from '@agentcerta/contracts';
import { UCP_PINNED_VERSION } from '@agentcerta/contracts';
import { createCheckout, getCheckout, getOffer, listOffers, type Database } from '@agentcerta/db';
import { formatMoney, hashCanonical } from '@agentcerta/domain';
import type { Clock } from '../clock.js';
import { ApiProblem } from '../http/problem.js';

const CHECKOUT_TTL_MS = 2 * 60 * 60 * 1000;

export function offerSummary(offer: Offer): string {
  const departure = offer.departureAt.slice(0, 16).replace('T', ' ');
  return `${offer.airline} ${offer.flightNumber} · ${offer.origin}→${offer.destination} · ${departure} · ${offer.cabin} · ${formatMoney(offer.total)}`;
}

export function toOfferView(offer: Offer): FlightOfferView {
  return { ...offer, summary: offerSummary(offer) };
}

/** Merchant-side catalog and checkout sessions. Prices are only ever read from storage. */
export class CheckoutService {
  constructor(private readonly deps: { db: Database; clock: Clock }) {}

  async searchFlights(query: FlightSearchQuery): Promise<FlightOfferView[]> {
    const now = this.deps.clock.now();
    const offers = await listOffers(this.deps.db, {
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

  async listCatalog(): Promise<FlightOfferView[]> {
    const now = this.deps.clock.now();
    const offers = await listOffers(this.deps.db, {});
    return offers.filter((o) => Date.parse(o.expiresAt) > now.getTime()).map(toOfferView);
  }

  async createSession(input: { offerId: string }): Promise<CheckoutSession> {
    const now = this.deps.clock.now();
    const offer = await getOffer(this.deps.db, input.offerId);
    if (!offer) throw ApiProblem.notFound('offer');
    if (offer.status !== 'AVAILABLE' || Date.parse(offer.expiresAt) <= now.getTime()) {
      throw ApiProblem.conflict('OFFER_NOT_AVAILABLE', 'The offer is no longer available');
    }
    const cart: CheckoutCart = {
      schema: 'agentcerta.cart.v1',
      merchantId: offer.merchantId,
      offerId: offer.id,
      lineItems: [
        {
          offerId: offer.id,
          description: offerSummary(offer),
          quantity: 1,
          unitPrice: offer.total,
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
