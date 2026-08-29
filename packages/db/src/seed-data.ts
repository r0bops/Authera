import type { Cabin, Currency } from '@authera/contracts';

/**
 * Deterministic demo scenario (spec §3 P0): Marta, VuelaYa, one purchasing agent, one
 * tokenized payment method, and a flight catalog where nothing is yet under USD 150.
 * Identifiers are fixed so tests, seeds, and demo controls agree.
 */
export const SEED_IDS = {
  marta: '11111111-1111-4111-8111-111111111111',
  agent: '22222222-2222-4222-8222-222222222222',
  vuelaya: '33333333-3333-4333-8333-333333333333',
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

export const SEED_MERCHANT = {
  id: SEED_IDS.vuelaya,
  slug: 'vuelaya',
  displayName: 'VuelaYa',
};

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
];

export const SEED_OFFER_EXPIRY = '2026-12-31T23:59:59.000Z';
