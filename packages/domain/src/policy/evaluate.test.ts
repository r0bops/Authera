import { describe, expect, it } from 'vitest';
import {
  PolicyVerdictSchema,
  REASON_CODES,
  type PolicyInput,
  type ReasonCode,
} from '@authera/contracts';
import { FIXTURE_IDS, FIXTURE_NOW, policyInputFixture } from '@authera/test-support';
import { evaluatePolicy } from './evaluate.js';

const OTHER_KEY = 'thumb-other-agent';

function withAmount(input: PolicyInput, minor: number): PolicyInput {
  return {
    ...input,
    offer: { ...input.offer, total: { ...input.offer.total, minor } },
    checkout: { ...input.checkout, total: { ...input.checkout.total, minor } },
  };
}

function failedCheck(verdict: ReturnType<typeof evaluatePolicy>): string | undefined {
  return verdict.checks.find((c) => !c.passed)?.code;
}

describe('evaluatePolicy — allow paths', () => {
  it('allows USD 130 under a USD 150 mandate with every check passing', () => {
    const verdict = evaluatePolicy(policyInputFixture());
    expect(verdict.decision).toBe('ALLOW');
    expect(verdict.reasonCode).toBe('ALLOW_WITHIN_MANDATE');
    expect(verdict.evaluatedAt).toBe(FIXTURE_NOW);
    expect(verdict.checks.every((c) => c.passed)).toBe(true);
    expect(verdict.checks.map((c) => c.code)).toEqual([
      'MANDATE_SCHEMA',
      'INPUT_SCHEMA',
      'AGENT_ACTIVE',
      'AGENT_BOUND',
      'RUNTIME_ACTIVE',
      'VALID_FROM',
      'VALID_UNTIL',
      'MERCHANT_ALLOWED',
      'OFFER_MERCHANT',
      'OFFER_AVAILABLE',
      'CHECKOUT_OFFER',
      'CHECKOUT_INTEGRITY',
      'CHECKOUT_TOTAL',
      'CHECKOUT_EXPIRY',
      'CURRENCY',
      'INTENT_KIND',
      'INTENT_ROUTE',
      'INTENT_CABIN',
      'INTENT_PASSENGERS',
      'INTENT_DATES',
      'USAGE_COUNT',
      'AMOUNT_PER_PURCHASE',
      'AMOUNT_TOTAL',
      'WITHIN_MANDATE',
    ]);
    expect(PolicyVerdictSchema.parse(verdict)).toEqual(verdict);
  });

  it('allows exactly USD 150.00 and blocks USD 150.01', () => {
    expect(evaluatePolicy(withAmount(policyInputFixture(), 15_000)).reasonCode).toBe(
      'ALLOW_WITHIN_MANDATE',
    );
    const over = evaluatePolicy(withAmount(policyInputFixture(), 15_001));
    expect(over.decision).toBe('BLOCK');
    expect(over.reasonCode).toBe('AMOUNT_EXCEEDED');
    expect(failedCheck(over)).toBe('AMOUNT_PER_PURCHASE');
  });

  it('normalizes airport and cabin casing before comparing', () => {
    const verdict = evaluatePolicy(
      policyInputFixture({ offer: { origin: 'ccs', destination: ' cor ', cabin: 'Economy' } }),
    );
    expect(verdict.reasonCode).toBe('ALLOW_WITHIN_MANDATE');
  });

  it('allows only the signed number of flexible travel days around the preferred window', () => {
    const mandate = { intent: { dateFlexibilityDays: 2 } };
    expect(
      evaluatePolicy(
        policyInputFixture({ mandate, offer: { departureAt: '2026-08-30T08:00:00.000Z' } }),
      ),
    ).toMatchObject({ decision: 'ALLOW', reasonCode: 'ALLOW_WITHIN_MANDATE' });
    expect(
      evaluatePolicy(
        policyInputFixture({ mandate, offer: { departureAt: '2026-08-29T08:00:00.000Z' } }),
      ),
    ).toMatchObject({ decision: 'BLOCK', reasonCode: 'INTENT_MISMATCH' });
  });

  it('allows an over-limit amount only through a valid checkout-scoped approval', () => {
    const input = withAmount(policyInputFixture(), 16_800);
    const approval = {
      checkoutHash: input.checkout.hash,
      expiresAt: '2026-08-30T13:00:00.000Z',
      status: 'ACTIVE' as const,
    };
    const allowed = evaluatePolicy({ ...input, checkoutScopedApproval: approval });
    expect(allowed.decision).toBe('ALLOW');
    expect(allowed.reasonCode).toBe('ALLOW_CHECKOUT_APPROVAL');

    const wrongHash = evaluatePolicy({
      ...input,
      checkoutScopedApproval: { ...approval, checkoutHash: 'sha256:other' },
    });
    expect(wrongHash).toMatchObject({ decision: 'BLOCK', reasonCode: 'APPROVAL_INVALID' });
    const consumed = evaluatePolicy({
      ...input,
      checkoutScopedApproval: { ...approval, status: 'CONSUMED' },
    });
    expect(consumed).toMatchObject({ decision: 'BLOCK', reasonCode: 'APPROVAL_INVALID' });
    const expired = evaluatePolicy({
      ...input,
      checkoutScopedApproval: { ...approval, expiresAt: '2026-08-30T11:59:59.000Z' },
    });
    expect(expired).toMatchObject({ decision: 'BLOCK', reasonCode: 'APPROVAL_INVALID' });
  });

  it('ignores a stale approval when the purchase is within the mandate anyway', () => {
    const input = policyInputFixture();
    const verdict = evaluatePolicy({
      ...input,
      checkoutScopedApproval: {
        checkoutHash: 'sha256:other',
        expiresAt: FIXTURE_NOW,
        status: 'REVOKED',
      },
    });
    expect(verdict.reasonCode).toBe('ALLOW_WITHIN_MANDATE');
  });
});

describe('evaluatePolicy — escalation', () => {
  it('pauses for a human on amount when the mandate escalates instead of blocking', () => {
    const input = withAmount(
      policyInputFixture({ mandate: { escalation: 'require_human' } }),
      16_800,
    );
    const verdict = evaluatePolicy(input);
    expect(verdict.decision).toBe('REQUIRE_HUMAN');
    expect(verdict.reasonCode).toBe('REQUIRE_HUMAN_AMOUNT');
  });

  it('pauses for a human on a date-window exception, blocks with INTENT_MISMATCH otherwise', () => {
    const outside = { offer: { departureAt: '2026-10-05T08:00:00.000Z' } };
    expect(
      evaluatePolicy(policyInputFixture({ ...outside, mandate: { escalation: 'require_human' } })),
    ).toMatchObject({
      decision: 'REQUIRE_HUMAN',
      reasonCode: 'REQUIRE_HUMAN_CONDITION',
    });
    expect(evaluatePolicy(policyInputFixture(outside))).toMatchObject({
      decision: 'BLOCK',
      reasonCode: 'INTENT_MISMATCH',
    });
  });

  it('never escalates a usage-count exhaustion', () => {
    const verdict = evaluatePolicy(
      policyInputFixture({
        mandate: { escalation: 'require_human' },
        runtime: { consumedCount: 1, consumedMinor: 13_000 },
      }),
    );
    expect(verdict).toMatchObject({ decision: 'BLOCK', reasonCode: 'USAGE_EXHAUSTED' });
  });
});

type Case = { name: string; input: () => unknown; reason: ReasonCode; check?: string };

const BLOCK_CASES: Case[] = [
  {
    name: 'unknown mandate schema',
    input: () => policyInputFixture({ mandate: { schema: 'authera.mandate.v9' as never } }),
    reason: 'MANDATE_INVALID',
    check: 'MANDATE_SCHEMA',
  },
  { name: 'input is not an object', input: () => 'nonsense', reason: 'MANDATE_INVALID' },
  {
    name: 'unknown mandate condition',
    input: () => ({
      ...policyInputFixture(),
      mandate: { ...policyInputFixture().mandate, maxDailySpendMinor: 5 },
    }),
    reason: 'INTERNAL_FAIL_CLOSED',
    check: 'INPUT_SCHEMA',
  },
  {
    name: 'unknown limit',
    input: () => {
      const i = policyInputFixture();
      return { ...i, mandate: { ...i.mandate, limits: { ...i.mandate.limits, perDay: 1 } } };
    },
    reason: 'INTERNAL_FAIL_CLOSED',
    check: 'INPUT_SCHEMA',
  },
  {
    name: 'unknown intent field',
    input: () => {
      const i = policyInputFixture();
      return { ...i, mandate: { ...i.mandate, intent: { ...i.mandate.intent, directOnly: true } } };
    },
    reason: 'INTERNAL_FAIL_CLOSED',
    check: 'INPUT_SCHEMA',
  },
  {
    name: 'negative counters',
    input: () => policyInputFixture({ runtime: { reservedMinor: -1 } }),
    reason: 'INTERNAL_FAIL_CLOSED',
    check: 'INPUT_SCHEMA',
  },
  {
    name: 'float money',
    input: () => withAmount(policyInputFixture(), 130.5),
    reason: 'INTERNAL_FAIL_CLOSED',
    check: 'INPUT_SCHEMA',
  },
  {
    name: 'revoked agent',
    input: () => policyInputFixture({ agent: { status: 'REVOKED' } }),
    reason: 'AGENT_REVOKED',
    check: 'AGENT_ACTIVE',
  },
  {
    name: 'other agent key',
    input: () => policyInputFixture({ agent: { keyThumbprint: OTHER_KEY } }),
    reason: 'AGENT_KEY_MISMATCH',
    check: 'AGENT_BOUND',
  },
  {
    name: 'other agent id',
    input: () => policyInputFixture({ agent: { id: FIXTURE_IDS.humanId } }),
    reason: 'AGENT_KEY_MISMATCH',
    check: 'AGENT_BOUND',
  },
  {
    name: 'runtime draft',
    input: () => policyInputFixture({ runtime: { status: 'DRAFT' } }),
    reason: 'MANDATE_NOT_ACTIVE',
    check: 'RUNTIME_ACTIVE',
  },
  {
    name: 'runtime revoked',
    input: () => policyInputFixture({ runtime: { status: 'REVOKED' } }),
    reason: 'MANDATE_REVOKED',
    check: 'RUNTIME_ACTIVE',
  },
  {
    name: 'runtime expired',
    input: () => policyInputFixture({ runtime: { status: 'EXPIRED' } }),
    reason: 'MANDATE_EXPIRED',
    check: 'RUNTIME_ACTIVE',
  },
  {
    name: 'runtime superseded',
    input: () => policyInputFixture({ runtime: { status: 'SUPERSEDED' } }),
    reason: 'MANDATE_SUPERSEDED',
    check: 'RUNTIME_ACTIVE',
  },
  {
    name: 'not yet valid',
    input: () => policyInputFixture({ now: '2026-08-28T23:59:59.999Z' }),
    reason: 'MANDATE_NOT_YET_VALID',
    check: 'VALID_FROM',
  },
  {
    name: 'expired by clock (now == validUntil)',
    input: () => policyInputFixture({ now: '2026-08-31T23:59:59.000Z' }),
    reason: 'MANDATE_EXPIRED',
    check: 'VALID_UNTIL',
  },
  {
    name: 'merchant not in allow-list',
    input: () =>
      policyInputFixture({
        merchant: { id: FIXTURE_IDS.otherMerchantId },
        offer: { merchantId: FIXTURE_IDS.otherMerchantId },
      }),
    reason: 'MERCHANT_NOT_ALLOWED',
    check: 'MERCHANT_ALLOWED',
  },
  {
    name: 'offer owned by another merchant',
    input: () => policyInputFixture({ offer: { merchantId: FIXTURE_IDS.otherMerchantId } }),
    reason: 'MERCHANT_NOT_ALLOWED',
    check: 'OFFER_MERCHANT',
  },
  {
    name: 'offer withdrawn',
    input: () => policyInputFixture({ offer: { status: 'WITHDRAWN' } }),
    reason: 'OFFER_NOT_AVAILABLE',
    check: 'OFFER_AVAILABLE',
  },
  {
    name: 'checkout bound to another offer',
    input: () => policyInputFixture({ checkout: { offerId: FIXTURE_IDS.mandateId } }),
    reason: 'CHECKOUT_HASH_MISMATCH',
    check: 'CHECKOUT_OFFER',
  },
  {
    name: 'cart mutated after hashing',
    input: () => policyInputFixture({ checkout: { computedHash: 'sha256:mutated' } }),
    reason: 'CHECKOUT_HASH_MISMATCH',
    check: 'CHECKOUT_INTEGRITY',
  },
  {
    name: 'checkout total differs from offer',
    input: () => policyInputFixture({ checkout: { total: { minor: 12_000 } } }),
    reason: 'CHECKOUT_HASH_MISMATCH',
    check: 'CHECKOUT_TOTAL',
  },
  {
    name: 'checkout expired',
    input: () => policyInputFixture({ checkout: { expiresAt: FIXTURE_NOW } }),
    reason: 'CHECKOUT_EXPIRED',
    check: 'CHECKOUT_EXPIRY',
  },
  {
    name: 'currency mismatch',
    input: () =>
      policyInputFixture({
        offer: { total: { currency: 'MXN' } },
        checkout: { total: { currency: 'MXN' } },
      }),
    reason: 'CURRENCY_MISMATCH',
    check: 'CURRENCY',
  },
  {
    name: 'wrong route',
    input: () => policyInputFixture({ offer: { destination: 'BOG' } }),
    reason: 'INTENT_MISMATCH',
    check: 'INTENT_ROUTE',
  },
  {
    name: 'wrong cabin',
    input: () => policyInputFixture({ offer: { cabin: 'business' } }),
    reason: 'INTENT_MISMATCH',
    check: 'INTENT_CABIN',
  },
  {
    name: 'wrong passenger count',
    input: () => policyInputFixture({ offer: { passengerCount: 2 } }),
    reason: 'INTENT_MISMATCH',
    check: 'INTENT_PASSENGERS',
  },
  {
    name: 'departure before window',
    input: () => policyInputFixture({ offer: { departureAt: '2026-08-31T23:00:00.000Z' } }),
    reason: 'INTENT_MISMATCH',
    check: 'INTENT_DATES',
  },
  {
    name: 'one-use mandate already consumed',
    input: () => policyInputFixture({ runtime: { consumedCount: 1, consumedMinor: 13_000 } }),
    reason: 'USAGE_EXHAUSTED',
    check: 'USAGE_COUNT',
  },
  {
    name: 'one-use mandate concurrently reserved',
    input: () => policyInputFixture({ runtime: { reservedCount: 1, reservedMinor: 13_000 } }),
    reason: 'USAGE_EXHAUSTED',
    check: 'USAGE_COUNT',
  },
  {
    name: 'per-purchase limit exceeded',
    input: () => withAmount(policyInputFixture(), 30_000),
    reason: 'AMOUNT_EXCEEDED',
    check: 'AMOUNT_PER_PURCHASE',
  },
  {
    name: 'total cap exceeded by prior spend',
    input: () =>
      withAmount(
        policyInputFixture({
          mandate: { limits: { maxFulfillments: 3, maxTotalMinor: 20_000 } },
          runtime: { consumedMinor: 10_000, consumedCount: 1 },
        }),
        13_000,
      ),
    reason: 'AMOUNT_EXCEEDED',
    check: 'AMOUNT_TOTAL',
  },
];

describe('evaluatePolicy — block paths (table)', () => {
  it.each(BLOCK_CASES)('$name → $reason', ({ input, reason, check }) => {
    const verdict = evaluatePolicy(input());
    expect(verdict.decision).toBe('BLOCK');
    expect(verdict.reasonCode).toBe(reason);
    if (check) expect(failedCheck(verdict)).toBe(check);
    expect(PolicyVerdictSchema.parse(verdict)).toEqual(verdict);
  });

  it('passes validity boundaries inclusively at validFrom and exclusively at validUntil', () => {
    const liveCheckout = { checkout: { expiresAt: '2026-09-01T00:00:00.000Z' } };
    expect(
      evaluatePolicy(policyInputFixture({ now: '2026-08-29T00:00:00.000Z', ...liveCheckout }))
        .decision,
    ).toBe('ALLOW');
    expect(
      evaluatePolicy(policyInputFixture({ now: '2026-08-31T23:59:58.999Z', ...liveCheckout }))
        .decision,
    ).toBe('ALLOW');
    expect(
      evaluatePolicy(policyInputFixture({ now: '2026-08-31T23:59:59.000Z', ...liveCheckout }))
        .reasonCode,
    ).toBe('MANDATE_EXPIRED');
  });

  it('never throws on garbage input and never allows it', () => {
    for (const garbage of [
      null,
      undefined,
      42,
      [],
      {},
      { mandate: null },
      { mandate: { schema: 'authera.mandate.v1' } },
    ]) {
      const verdict = evaluatePolicy(garbage);
      expect(verdict.decision).toBe('BLOCK');
      expect(['MANDATE_INVALID', 'INTERNAL_FAIL_CLOSED']).toContain(verdict.reasonCode);
      expect(PolicyVerdictSchema.parse(verdict)).toEqual(verdict);
    }
  });
});

describe('reason code coverage', () => {
  const EVALUATOR_CODES = new Set<ReasonCode>([
    ...BLOCK_CASES.map((c) => c.reason),
    'ALLOW_WITHIN_MANDATE',
    'ALLOW_CHECKOUT_APPROVAL',
    'REQUIRE_HUMAN_AMOUNT',
    'REQUIRE_HUMAN_CONDITION',
    'APPROVAL_INVALID',
  ]);
  /** Produced by the identity, reservation, and payment layers, not by the pure evaluator. */
  const LAYER_CODES: ReasonCode[] = [
    'AGENT_UNKNOWN',
    'SIGNATURE_INVALID',
    'REQUEST_EXPIRED',
    'REPLAY_DETECTED',
    'RESERVATION_CONFLICT',
    'BOOKING_FAILED',
    'PAYMENT_FAILED',
  ];

  it('every required reason code is either exercised here or reserved for a named layer', () => {
    for (const code of REASON_CODES) {
      expect(EVALUATOR_CODES.has(code) || LAYER_CODES.includes(code), code).toBe(true);
    }
    for (const code of LAYER_CODES) expect(EVALUATOR_CODES.has(code)).toBe(false);
  });
});
