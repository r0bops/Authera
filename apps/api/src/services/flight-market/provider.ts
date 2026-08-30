import type { Cabin, Currency, FlightSearchQuery } from '@authera/contracts';

/** An offer as returned by an external flight market, before it is stored server-side. */
export interface MarketOffer {
  /** Provider-scoped offer id (e.g. Duffel `off_…`). Unique per provider. */
  providerOfferId: string;
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  cabin: Cabin;
  departureAt: Date;
  arrivalAt: Date;
  /** Connections on the slice (0 = direct). */
  stops: number;
  passengerCount: number;
  amountMinor: number;
  currency: Currency;
  expiresAt: Date;
}

export interface RevalidatedOffer {
  available: boolean;
  amountMinor?: number;
  currency?: Currency;
  expiresAt?: Date;
}

/**
 * External flight market behind one Authera merchant. Providers only *discover*; every price the
 * gateway uses is read back from the `offers` table after `CheckoutService` stores it, and the
 * winner is revalidated with the provider before a checkout session is created.
 */
export interface FlightMarketProvider {
  /** Stable provider key, also the offer `source` value. */
  readonly source: 'duffel';
  /** Merchant that publishes this provider's offers. */
  readonly merchantId: string;
  search(query: FlightSearchQuery, options?: { signal?: AbortSignal }): Promise<MarketOffer[]>;
  revalidate(
    providerOfferId: string,
    options?: { signal?: AbortSignal },
  ): Promise<RevalidatedOffer>;
}
