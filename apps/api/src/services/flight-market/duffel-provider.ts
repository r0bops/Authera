import type { Cabin, Currency, FlightSearchQuery } from '@authera/contracts';
import type { FlightMarketProvider, MarketOffer, RevalidatedOffer } from './provider.js';

export const DUFFEL_BASE_URL = 'https://api.duffel.com';
const DUFFEL_VERSION = 'v2';
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_OFFERS = 40;

export interface DuffelProviderOptions {
  accessToken: string;
  merchantId: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Test-mode offers expire quickly; cap how far ahead we trust the provider's expiry. */
  maxExpiryMs?: number;
}

/** Subset of Duffel's offer payload that Authera maps. Everything else is ignored. */
export interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  expires_at: string;
  owner: { name: string; iata_code?: string | null };
  passengers?: Array<{ type?: string }>;
  slices: Array<{
    segments: Array<{
      departing_at: string;
      arriving_at: string;
      origin: { iata_code: string };
      destination: { iata_code: string };
      marketing_carrier?: { iata_code?: string | null; name?: string | null } | null;
      marketing_carrier_flight_number?: string | null;
      passengers?: Array<{ cabin_class?: string | null }>;
    }>;
  }>;
}

export class DuffelApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DuffelApiError';
  }
}

/**
 * Duffel Flights API (test mode for the hackathon). One offer request per search; offers are
 * returned inline. Local segment times carry no offset in Duffel's payload, so they are stored
 * as-is with a `Z` suffix — accurate enough for date-window policy, not for timezone math.
 */
export class DuffelFlightMarketProvider implements FlightMarketProvider {
  readonly source = 'duffel' as const;
  readonly merchantId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxExpiryMs: number;

  constructor(private readonly options: DuffelProviderOptions) {
    this.merchantId = options.merchantId;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? DUFFEL_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxExpiryMs = options.maxExpiryMs ?? 24 * 60 * 60 * 1000;
  }

  async search(
    query: FlightSearchQuery,
    options: { signal?: AbortSignal } = {},
  ): Promise<MarketOffer[]> {
    // Duffel searches one departure date; sweep the window on a few dates, cheapest first.
    const dates = departureDates(query);
    const results = await Promise.all(
      dates.map((date) => this.offerRequest(query, date, options.signal)),
    );
    const seen = new Set<string>();
    const offers: MarketOffer[] = [];
    for (const batch of results) {
      for (const offer of batch) {
        if (seen.has(offer.providerOfferId)) continue;
        seen.add(offer.providerOfferId);
        offers.push(offer);
      }
    }
    return offers
      .sort(
        (a, b) =>
          a.amountMinor - b.amountMinor || a.departureAt.getTime() - b.departureAt.getTime(),
      )
      .slice(0, MAX_OFFERS);
  }

  async revalidate(
    providerOfferId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<RevalidatedOffer> {
    const response = await this.request(
      'GET',
      `/air/offers/${encodeURIComponent(providerOfferId)}`,
      undefined,
      options.signal,
    );
    if (response.status === 404 || response.status === 410) return { available: false };
    if (!response.ok) throw new DuffelApiError(response.status, 'Duffel offer lookup failed');
    const body = (await response.json()) as { data: DuffelOffer };
    const mapped = mapDuffelOffer(body.data, { passengerCount: 1, cabin: 'economy' });
    if (!mapped) return { available: false };
    return {
      available: mapped.expiresAt.getTime() > Date.now(),
      amountMinor: mapped.amountMinor,
      currency: mapped.currency,
      expiresAt: mapped.expiresAt,
    };
  }

  private async offerRequest(
    query: FlightSearchQuery,
    departureDate: string,
    signal: AbortSignal | undefined,
  ): Promise<MarketOffer[]> {
    const passengerCount = query.passengers ?? 1;
    const response = await this.request(
      'POST',
      '/air/offer_requests?return_offers=true',
      {
        data: {
          slices: [
            { origin: query.origin, destination: query.destination, departure_date: departureDate },
          ],
          passengers: Array.from({ length: passengerCount }, () => ({ type: 'adult' })),
          cabin_class: 'economy',
          max_connections: 1,
        },
      },
      signal,
    );
    if (!response.ok) throw new DuffelApiError(response.status, 'Duffel offer request failed');
    const body = (await response.json()) as { data: { offers: DuffelOffer[] } };
    const now = Date.now();
    return body.data.offers
      .map((offer) => mapDuffelOffer(offer, { passengerCount, cabin: 'economy' }))
      .filter((offer): offer is MarketOffer => offer !== null)
      .map((offer) => ({
        ...offer,
        expiresAt: new Date(Math.min(offer.expiresAt.getTime(), now + this.maxExpiryMs)),
      }));
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.options.accessToken}`,
        'Duffel-Version': DUFFEL_VERSION,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  }
}

/** Pick up to three departure dates inside the window: start, middle, end. */
export function departureDates(query: FlightSearchQuery): string[] {
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from && query.from > today ? query.from : today;
  const to = query.to ?? from;
  if (to <= from) return [from];
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  const mid = new Date(start + Math.floor((end - start) / 2)).toISOString().slice(0, 10);
  return [...new Set([from, mid, to])];
}

// Must stay a subset of the contracts' CurrencySchema.
const SUPPORTED_CURRENCIES = new Set(['USD', 'MXN', 'COP', 'BRL', 'ARS']);

/** Pure mapping from a Duffel offer to Authera's market offer; null when it cannot be trusted. */
export function mapDuffelOffer(
  offer: DuffelOffer,
  context: { passengerCount: number; cabin: Cabin },
): MarketOffer | null {
  const slice = offer.slices[0];
  const first = slice?.segments[0];
  const last = slice?.segments[slice.segments.length - 1];
  if (!slice || !first || !last) return null;
  const amount = Number.parseFloat(offer.total_amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const currency = offer.total_currency.toUpperCase();
  if (!SUPPORTED_CURRENCIES.has(currency)) return null;
  const expiresAt = new Date(offer.expires_at);
  const departureAt = localToDate(first.departing_at);
  const arrivalAt = localToDate(last.arriving_at);
  if ([expiresAt, departureAt, arrivalAt].some((d) => Number.isNaN(d.getTime()))) return null;
  const carrier = first.marketing_carrier?.iata_code ?? offer.owner.iata_code ?? 'XX';
  const number = first.marketing_carrier_flight_number ?? '0';
  return {
    providerOfferId: offer.id,
    airline: first.marketing_carrier?.name ?? offer.owner.name,
    flightNumber: `${carrier}${number}`,
    origin: first.origin.iata_code.toUpperCase(),
    destination: last.destination.iata_code.toUpperCase(),
    cabin: context.cabin,
    departureAt,
    arrivalAt,
    passengerCount: context.passengerCount,
    amountMinor: Math.round(amount * 100),
    currency: currency as Currency,
    expiresAt,
  };
}

function localToDate(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}
