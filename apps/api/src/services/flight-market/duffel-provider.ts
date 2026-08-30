import type { Cabin, Currency, FlightSearchQuery } from '@authera/contracts';
import type { FlightMarketProvider, MarketOffer, RevalidatedOffer } from './provider.js';

export const DUFFEL_BASE_URL = 'https://api.duffel.com';
const DUFFEL_VERSION = 'v2';
const DEFAULT_TIMEOUT_MS = 8_000;
const ORDER_TIMEOUT_MS = 130_000;
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
  passengers?: Array<{ id?: string; type?: string }>;
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

export class DuffelOrderError extends DuffelApiError {
  constructor(
    status: number,
    message: string,
    /** False means the airline may have received the request; do not guess or retry blindly. */
    readonly definitive: boolean,
  ) {
    super(status, message);
    this.name = 'DuffelOrderError';
  }
}

export interface DuffelTraveler {
  givenName: string;
  familyName: string;
  bornOn: string;
  gender: 'm' | 'f';
  title: 'mr' | 'ms' | 'mrs' | 'miss' | 'dr';
  email: string;
  phoneNumber: string;
}

export interface DuffelOrderResult {
  providerOrderId: string;
  bookingReference: string | null;
  liveMode: boolean;
  documents: Array<{ type: string; uniqueIdentifier: string | null }>;
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
    const response = await withOneRetry(() =>
      this.request(
        'GET',
        `/air/offers/${encodeURIComponent(providerOfferId)}`,
        undefined,
        options.signal,
      ),
    );
    // Any client-side status means the provider no longer honours this offer id.
    if (response.status >= 400 && response.status < 500 && response.status !== 429)
      return { available: false };
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

  /** Create one paid Duffel sandbox order after Stripe has authorized the same amount. */
  async createOrder(input: {
    providerOfferId: string;
    executionId: string;
    stripePaymentIntentId: string;
    amountMinor: number;
    currency: Currency;
    traveler: DuffelTraveler;
  }): Promise<DuffelOrderResult> {
    if (!this.options.accessToken.startsWith('duffel_test_')) {
      throw new DuffelOrderError(
        400,
        'Flight ordering is restricted to Duffel test-mode tokens',
        true,
      );
    }
    const offerResponse = await this.request(
      'GET',
      `/air/offers/${encodeURIComponent(input.providerOfferId)}`,
      undefined,
      undefined,
    );
    if (offerResponse.status === 404 || offerResponse.status === 410) {
      throw new DuffelOrderError(offerResponse.status, 'Duffel offer is no longer bookable', true);
    }
    if (!offerResponse.ok) {
      throw new DuffelOrderError(
        offerResponse.status,
        'Duffel offer lookup failed before booking',
        isDefinitiveOrderFailure(offerResponse.status),
      );
    }
    const offer = ((await offerResponse.json()) as { data: DuffelOffer }).data;
    const mapped = mapDuffelOffer(offer, { passengerCount: 1, cabin: 'economy' });
    const passenger = offer.passengers?.[0];
    if (
      !mapped ||
      mapped.providerOfferId !== input.providerOfferId ||
      mapped.amountMinor !== input.amountMinor ||
      mapped.currency !== input.currency ||
      offer.passengers?.length !== 1 ||
      !passenger?.id
    ) {
      throw new DuffelOrderError(
        409,
        'Duffel offer price, currency, or passenger binding changed before booking',
        true,
      );
    }

    const response = await this.request(
      'POST',
      '/air/orders',
      {
        data: {
          type: 'instant',
          selected_offers: [input.providerOfferId],
          payments: [
            {
              type: 'balance',
              currency: input.currency,
              amount: minorToDecimal(input.amountMinor),
            },
          ],
          passengers: [
            {
              id: passenger.id,
              given_name: input.traveler.givenName,
              family_name: input.traveler.familyName,
              born_on: input.traveler.bornOn,
              gender: input.traveler.gender,
              title: input.traveler.title,
              email: input.traveler.email,
              phone_number: input.traveler.phoneNumber,
            },
          ],
          metadata: {
            execution_id: input.executionId,
            stripe_payment_intent_id: input.stripePaymentIntentId,
          },
        },
      },
      undefined,
      ORDER_TIMEOUT_MS,
    );
    if (!response.ok) {
      const detail = await duffelErrorDetail(response);
      throw new DuffelOrderError(
        response.status,
        `Duffel order creation failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        isDefinitiveOrderFailure(response.status),
      );
    }
    const order = (
      (await response.json()) as {
        data: {
          id?: string;
          booking_reference?: string | null;
          live_mode?: boolean;
          offer_id?: string;
          total_amount?: string;
          total_currency?: string;
          documents?: Array<{ type?: string; unique_identifier?: string | null }>;
        };
      }
    ).data;
    const totalMinor = decimalToMinor(order.total_amount);
    if (
      !order.id ||
      order.live_mode !== false ||
      (order.offer_id !== undefined && order.offer_id !== input.providerOfferId) ||
      totalMinor !== input.amountMinor ||
      order.total_currency?.toUpperCase() !== input.currency
    ) {
      // A 2xx order may exist. Leave this for reconciliation instead of charging or retrying.
      throw new DuffelOrderError(500, 'Duffel returned an ambiguous order confirmation', false);
    }
    return {
      providerOrderId: order.id,
      bookingReference: order.booking_reference ?? null,
      liveMode: false,
      documents: (order.documents ?? []).map((document) => ({
        type: document.type ?? 'unknown',
        uniqueIdentifier: document.unique_identifier ?? null,
      })),
    };
  }

  private async offerRequest(
    query: FlightSearchQuery,
    departureDate: string,
    signal: AbortSignal | undefined,
  ): Promise<MarketOffer[]> {
    const passengerCount = query.passengers ?? 1;
    const response = await withOneRetry(() =>
      this.request(
        'POST',
        '/air/offer_requests?return_offers=true',
        {
          data: {
            slices: [
              {
                origin: query.origin,
                destination: query.destination,
                departure_date: departureDate,
              },
            ],
            passengers: Array.from({ length: passengerCount }, () => ({ type: 'adult' })),
            cabin_class: 'economy',
            max_connections: 1,
          },
        },
        signal,
      ),
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
    timeoutMs = this.timeoutMs,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
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

async function duffelErrorDetail(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as {
      errors?: Array<{ code?: string; title?: string; message?: string }>;
    };
    return (
      body.errors
        ?.slice(0, 3)
        .map((error) => [error.code, error.title, error.message].filter(Boolean).join(': '))
        .filter(Boolean)
        .join('; ')
        .slice(0, 500) || null
    );
  } catch {
    return null;
  }
}

function minorToDecimal(minor: number): string {
  return `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

function decimalToMinor(value: string | undefined): number | null {
  if (!value || !/^\d+\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(result) ? result : null;
}

function isDefinitiveOrderFailure(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
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

/** One retry after a short pause on a network error, 429 or 5xx — enough for a busy demo, never a loop. */
export async function withOneRetry(send: () => Promise<Response>): Promise<Response> {
  let pauseMs = 300;
  try {
    const first = await send();
    if (first.status !== 429 && first.status < 500) return first;
    if (first.status === 429) pauseMs = 1_000;
  } catch (error) {
    // an aborted request (caller timeout) must not be retried; a network blip may
    if (error instanceof Error && error.name === 'AbortError') throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, pauseMs));
  return send();
}
