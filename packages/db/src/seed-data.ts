/**
 * Deterministic demo seed (spec §3 P0): Marta, her purchasing agent, one tokenized payment
 * method, and the live flight merchant. No invented catalog: every offer on the dashboard comes
 * from a real market search (Duffel) or from an explicitly labelled judge injection.
 */
export const SEED_IDS = {
  marta: '11111111-1111-4111-8111-111111111111',
  agent: '22222222-2222-4222-8222-222222222222',
  duffel: '33333333-3333-4333-8333-333333333336',
  allbirds: '33333333-3333-4333-8333-333333333337',
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

/** Live market only. Demo controls may inject clearly labelled offers under this merchant. */
export const SEED_MERCHANTS: SeedMerchant[] = [
  { id: SEED_IDS.duffel, slug: 'duffel', displayName: 'Duffel Marketplace', market: 'GB' },
  /** Live goods market: Allbirds' public Shopify storefront (real catalog and prices). */
  { id: SEED_IDS.allbirds, slug: 'allbirds', displayName: 'Allbirds (Shopify)', market: 'US' },
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



