import type { MandatePolicyV1, PolicyInput } from '@authera/contracts';

/** Deterministic identifiers shared by fixtures, seeds, and tests. */
export const FIXTURE_IDS = {
  humanId: '11111111-1111-4111-8111-111111111111',
  agentId: '22222222-2222-4222-8222-222222222222',
  merchantId: '33333333-3333-4333-8333-333333333333',
  otherMerchantId: '33333333-3333-4333-8333-999999999999',
  mandateId: '44444444-4444-4444-8444-444444444444',
  offerId: '55555555-5555-4555-8555-555555555555',
  checkoutId: '66666666-6666-4666-8666-666666666666',
  agentKeyThumbprint: 'thumb-agent-fixture-0001',
} as const;

export const FIXTURE_NOW = '2026-08-30T12:00:00.000Z';

export function mandatePolicyFixture(overrides: Partial<MandatePolicyV1> = {}): MandatePolicyV1 {
  return {
    schema: 'authera.mandate.v1',
    mandateId: FIXTURE_IDS.mandateId,
    version: 1,
    humanId: FIXTURE_IDS.humanId,
    agentId: FIXTURE_IDS.agentId,
    agentKeyThumbprint: FIXTURE_IDS.agentKeyThumbprint,
    allowedMerchantIds: [FIXTURE_IDS.merchantId],
    paymentMethodRef: 'pm_fixture_4242',
    intent: {
      type: 'flight',
      origin: 'CCS',
      destination: 'COR',
      cabin: 'economy',
      departureDateFrom: '2026-09-01',
      departureDateTo: '2026-09-30',
      passengerCount: 1,
    },
    limits: {
      currency: 'USD',
      maxPerPurchaseMinor: 15_000,
      maxTotalMinor: 15_000,
      maxFulfillments: 1,
    },
    validFrom: '2026-08-29T00:00:00.000Z',
    validUntil: '2026-08-31T23:59:59.000Z',
    escalation: 'block',
    ...overrides,
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/**
 * A complete, in-mandate policy input: USD 130 offer under a USD 150 mandate.
 * Override nested fields to build each failure story.
 */
export function policyInputFixture(overrides: DeepPartial<PolicyInput> = {}): PolicyInput {
  const base: PolicyInput = {
    now: FIXTURE_NOW,
    agent: {
      id: FIXTURE_IDS.agentId,
      keyThumbprint: FIXTURE_IDS.agentKeyThumbprint,
      status: 'ACTIVE',
    },
    mandate: mandatePolicyFixture(),
    runtime: {
      status: 'ACTIVE',
      reservedMinor: 0,
      consumedMinor: 0,
      reservedCount: 0,
      consumedCount: 0,
    },
    merchant: { id: FIXTURE_IDS.merchantId },
    offer: {
      id: FIXTURE_IDS.offerId,
      kind: 'flight',
      quantity: 1,
      merchantId: FIXTURE_IDS.merchantId,
      origin: 'CCS',
      destination: 'COR',
      cabin: 'economy',
      departureAt: '2026-09-15T08:00:00.000Z',
      passengerCount: 1,
      total: { currency: 'USD', minor: 13_000 },
      status: 'AVAILABLE',
    },
    checkout: {
      id: FIXTURE_IDS.checkoutId,
      hash: 'sha256:fixture-cart-hash',
      computedHash: 'sha256:fixture-cart-hash',
      total: { currency: 'USD', minor: 13_000 },
      offerId: FIXTURE_IDS.offerId,
      expiresAt: '2026-08-30T12:30:00.000Z',
    },
  };
  return deepMerge(base, overrides) as PolicyInput;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, overrides: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(overrides))
    return overrides === undefined ? base : overrides;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = value === undefined ? undefined : deepMerge(base[key], value);
  }
  return result;
}
