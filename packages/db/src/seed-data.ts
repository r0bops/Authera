import type { Cabin, Currency } from '@authera/contracts';

/**
 * Deterministic demo scenario (spec §3 P0): Marta, one purchasing agent, one tokenized payment
 * method, and three merchants in three markets (VE, AR, CO) whose flight catalogs the agent
 * searches and compares. Nothing on CCS→COR is yet under USD 150.
 * Identifiers are fixed so tests, seeds, and demo controls agree.
 */
export const SEED_IDS = {
  marta: '11111111-1111-4111-8111-111111111111',
  agent: '22222222-2222-4222-8222-222222222222',
  vuelaya: '33333333-3333-4333-8333-333333333333',
  aerosur: '33333333-3333-4333-8333-333333333334',
  andesgo: '33333333-3333-4333-8333-333333333335',
  agentKey: '22222222-2222-4222-8222-aaaaaaaaaaaa',
  trustedSurfaceKey: '99999999-9999-4999-8999-000000000001',
  merchantKey: '99999999-9999-4999-8999-000000000002',
  paymentMethod: '77777777-7777-4777-8777-777777777777',
} as const;

export const SEED_USER = {
  id: SEED_IDS.marta,
  email: 'marta@example.com',
  displayName: 'Marta Ledezma',
};

export interface SeedMerchant {
  id: string;
  slug: string;
  displayName: string;
  /** ISO 3166-1 alpha-2 market the merchant sells from. */
  market: string;
}

/** Three independent markets. The agent must search all of them and choose. */
export const SEED_MERCHANTS: SeedMerchant[] = [
  { id: SEED_IDS.vuelaya, slug: 'vuelaya', displayName: 'VuelaYa', market: 'VE' },
  { id: SEED_IDS.aerosur, slug: 'aerosur', displayName: 'AeroSur', market: 'AR' },
  { id: SEED_IDS.andesgo, slug: 'andesgo', displayName: 'AndesGo Travel', market: 'CO' },
];

/** Default merchant for demo controls that do not name one. */
export const SEED_MERCHANT = SEED_MERCHANTS[0]!;

export const SEED_AGENT = {
  id: SEED_IDS.agent,
  displayName: 'Aria — Marta’s purchasing agent',
};

export const SEED_PAYMENT_METHOD = {
  id: SEED_IDS.paymentMethod,
  provider: 'mock',
  tokenRef: 'tok_mock_visa_4242_ref_7f3a',
  displayBrand: 'Visa',
  displayLast4: '4242',
};

export interface SeedOffer {
  id: string;
  merchantId: string;
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  cabin: Cabin;
  departureAt: string;
  arrivalAt: string;
  passengerCount: number;
  amountMinor: number;
  currency: Currency;
}

const offerId = (n: number) => `55555555-5555-4555-8555-${n.toString().padStart(12, '0')}`;

export const SEED_OFFERS: SeedOffer[] = [
  {
    id: offerId(1),
    merchantId: SEED_IDS.vuelaya,
    airline: 'VuelaYa',
    flightNumber: 'VY201',
    origin: 'CCS',
    destination: 'COR',
    cabin: 'economy',
    departureAt: '2026-09-12T08:05:00.000Z',
    arrivalAt: '2026-09-12T13:40:00.000Z',
    passengerCount: 1,
    amountMinor: 18_400,
    currency: 'USD',
  },
  {
    id: offerId(2),
    merchantId: SEED_IDS.vuelaya,
    airline: 'VuelaYa',
    flightNumber: 'VY205',
    origin: 'CCS',
    destination: 'COR',
    cabin: 'economy',
    departureAt: '2026-09-15T06:30:00.000Z',
    arrivalAt: '2026-09-15T12:10:00.000Z',
    passengerCount: 1,
    amountMinor: 19_900,
    currency: 'USD',
  },
  {
    id: offerId(3),
    merchantId: SEED_IDS.vuelaya,
    airline: 'VuelaYa',
    flightNumber: 'VY209',
    origin: 'CCS',
    destination: 'COR',
    cabin: 'economy',
    departureAt: '2026-09-19T14:20:00.000Z',
    arrivalAt: '2026-09-19T20:05:00.000Z',
    passengerCount: 1,
    amountMinor: 17_600,
    currency: 'USD',
  },
  {
    id: offerId(4),
    merchantId: SEED_IDS.vuelaya,
    airline: 'VuelaYa',
    flightNumber: 'VY210',
    origin: 'CCS',
    destination: 'COR',
    cabin: 'business',
    departureAt: '2026-09-15T06:30:00.000Z',
    arrivalAt: '2026-09-15T12:10:00.000Z',
    passengerCount: 1,
    amountMinor: 42_000,
    currency: 'USD',
  },
  {
    id: offerId(5),
    merchantId: SEED_IDS.vuelaya,
    airline: 'VuelaYa',
    flightNumber: 'VY301',
    origin: 'CCS',
    destination: 'BOG',
    cabin: 'economy',
    departureAt: '2026-09-14T09:00:00.000Z',
    arrivalAt: '2026-09-14T11:05:00.000Z',
    passengerCount: 1,
    amountMinor: 12_000,
    currency: 'USD',
  },
  // AeroSur (AR market): same route, a little cheaper, later departure.
  {
    id: offerId(6),
    merchantId: SEED_IDS.aerosur,
    airline: 'AeroSur',
    flightNumber: 'AS412',
    origin: 'CCS',
    destination: 'COR',
    cabin: 'economy',
    departureAt: '2026-09-16T11:45:00.000Z',
    arrivalAt: '2026-09-16T17:55:00.000Z',
    passengerCount: 1,
    amountMinor: 16_900,
    currency: 'USD',
  },
  {
    id: offerId(7),
    merchantId: SEED_IDS.aerosur,
    airline: 'AeroSur',
    flightNumber: 'AS418',
    origin: 'CCS',
    destination: 'COR',
    cabin: 'economy',
    departureAt: '2026-09-22T07:10:00.000Z',
    arrivalAt: '2026-09-22T13:20:00.000Z',
    passengerCount: 1,
    amountMinor: 15_800,
    currency: 'USD',
  },
  // AndesGo Travel (CO market): an OTA reselling a one-stop itinerary via Bogotá.
  {
    id: offerId(8),
    merchantId: SEED_IDS.andesgo,
    airline: 'AndesGo Travel',
    flightNumber: 'AG77',
    origin: 'CCS',
    destination: 'COR',
    cabin: 'economy',
    departureAt: '2026-09-18T05:50:00.000Z',
    arrivalAt: '2026-09-18T15:30:00.000Z',
    passengerCount: 1,
    amountMinor: 15_300,
    currency: 'USD',
  },
  {
    id: offerId(9),
    merchantId: SEED_IDS.andesgo,
    airline: 'AndesGo Travel',
    flightNumber: 'AG81',
    origin: 'CCS',
    destination: 'COR',
    cabin: 'business',
    departureAt: '2026-09-18T05:50:00.000Z',
    arrivalAt: '2026-09-18T15:30:00.000Z',
    passengerCount: 1,
    amountMinor: 38_500,
    currency: 'USD',
  },
];

export const SEED_OFFER_EXPIRY = '2026-12-31T23:59:59.000Z';
