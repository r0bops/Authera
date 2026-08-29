import { describe, expect, it, vi } from 'vitest';
import {
  DuffelFlightMarketProvider,
  departureDates,
  mapDuffelOffer,
  type DuffelOffer,
} from './duffel-provider.js';

const MERCHANT = '33333333-3333-4333-8333-333333333336';

function duffelOffer(overrides: Partial<DuffelOffer> = {}): DuffelOffer {
  return {
    id: 'off_0000B9sYG2Lkmvyq0MrGbk',
    total_amount: '192.42',
    total_currency: 'USD',
    expires_at: '2099-01-01T00:00:00.000000Z',
    owner: { name: 'Copa Airlines', iata_code: 'CM' },
    slices: [
      {
        segments: [
          {
            departing_at: '2026-09-15T13:37:00',
            arriving_at: '2026-09-15T16:10:00',
            origin: { iata_code: 'CCS' },
            destination: { iata_code: 'PTY' },
            marketing_carrier: { iata_code: 'CM', name: 'Copa Airlines' },
            marketing_carrier_flight_number: '224',
          },
          {
            departing_at: '2026-09-15T18:00:00',
            arriving_at: '2026-09-16T02:30:00',
            origin: { iata_code: 'PTY' },
            destination: { iata_code: 'COR' },
            marketing_carrier: { iata_code: 'CM', name: 'Copa Airlines' },
            marketing_carrier_flight_number: '431',
          },
        ],
      },
    ],
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Duffel offer mapping', () => {
  it('maps a multi-segment offer to one server-owned candidate in minor units', () => {
    const mapped = mapDuffelOffer(duffelOffer(), { passengerCount: 1, cabin: 'economy' });
    expect(mapped).toMatchObject({
      providerOfferId: 'off_0000B9sYG2Lkmvyq0MrGbk',
      airline: 'Copa Airlines',
      flightNumber: 'CM224',
      origin: 'CCS',
      destination: 'COR',
      cabin: 'economy',
      amountMinor: 19_242,
      currency: 'USD',
      passengerCount: 1,
    });
    expect(mapped?.departureAt.toISOString()).toBe('2026-09-15T13:37:00.000Z');
    expect(mapped?.arrivalAt.toISOString()).toBe('2026-09-16T02:30:00.000Z');
  });

  it('refuses offers it cannot trust: unsupported currency, bad amount, missing segments', () => {
    const ctx = { passengerCount: 1, cabin: 'economy' as const };
    expect(mapDuffelOffer(duffelOffer({ total_currency: 'GBP' }), ctx)).toBeNull();
    expect(mapDuffelOffer(duffelOffer({ total_amount: 'free' }), ctx)).toBeNull();
    expect(mapDuffelOffer(duffelOffer({ total_amount: '-1' }), ctx)).toBeNull();
    expect(mapDuffelOffer(duffelOffer({ slices: [] }), ctx)).toBeNull();
    expect(mapDuffelOffer(duffelOffer({ expires_at: 'soon' }), ctx)).toBeNull();
  });

  it('sweeps at most three departure dates inside the window', () => {
    expect(
      departureDates({ origin: 'CCS', destination: 'COR', from: '2099-09-01', to: '2099-09-30' }),
    ).toEqual(['2099-09-01', '2099-09-15', '2099-09-30']);
    expect(
      departureDates({ origin: 'CCS', destination: 'COR', from: '2099-09-01', to: '2099-09-01' }),
    ).toEqual(['2099-09-01']);
  });
});

describe('DuffelFlightMarketProvider', () => {
  it('searches with the bearer token and returns deduplicated offers cheapest first', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(201, {
        data: {
          offers: [
            duffelOffer({ id: 'off_b', total_amount: '300.00' }),
            duffelOffer({ id: 'off_a', total_amount: '120.50' }),
            duffelOffer({ id: 'off_b', total_amount: '300.00' }),
          ],
        },
      });
    });
    const provider = new DuffelFlightMarketProvider({
      accessToken: 'duffel_test_secret',
      merchantId: MERCHANT,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const offers = await provider.search({
      origin: 'CCS',
      destination: 'COR',
      from: '2099-09-01',
      to: '2099-09-01',
    });

    expect(offers.map((o) => [o.providerOfferId, o.amountMinor])).toEqual([
      ['off_a', 12_050],
      ['off_b', 30_000],
    ]);
    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer duffel_test_secret');
    expect(headers['Duffel-Version']).toBe('v2');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      data: { slices: [{ origin: 'CCS', destination: 'COR', departure_date: '2099-09-01' }] },
    });
  });

  it('surfaces provider failures so the catalog can fail open', async () => {
    const provider = new DuffelFlightMarketProvider({
      accessToken: 't',
      merchantId: MERCHANT,
      fetch: (async () => jsonResponse(500, { errors: [{ title: 'boom' }] })) as typeof fetch,
    });
    await expect(
      provider.search({ origin: 'CCS', destination: 'COR', from: '2099-09-01', to: '2099-09-01' }),
    ).rejects.toThrow('Duffel offer request failed');
  });

  it('revalidates a stored offer: re-priced, gone, or expired', async () => {
    const responses = [
      jsonResponse(200, { data: duffelOffer({ total_amount: '210.00' }) }),
      jsonResponse(404, { errors: [] }),
      jsonResponse(200, { data: duffelOffer({ expires_at: '2000-01-01T00:00:00Z' }) }),
    ];
    const provider = new DuffelFlightMarketProvider({
      accessToken: 't',
      merchantId: MERCHANT,
      fetch: (async () => responses.shift()!) as typeof fetch,
    });
    await expect(provider.revalidate('off_x')).resolves.toMatchObject({
      available: true,
      amountMinor: 21_000,
      currency: 'USD',
    });
    await expect(provider.revalidate('off_x')).resolves.toEqual({ available: false });
    await expect(provider.revalidate('off_x')).resolves.toMatchObject({ available: false });
  });
});
