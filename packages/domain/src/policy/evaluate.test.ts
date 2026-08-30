import { describe, expect, it } from 'vitest';
import {
  PolicyVerdictSchema,
  REASON_CODES,
  type PolicyInput,
  type ReasonCode,
} from '@authera/contracts';
import { FIXTURE_IDS, FIXTURE_NOW, policyInputFixture } from '@authera/test-support';
import { evaluatePolicy } from './evaluate.js';
import { approvalTolerance } from './tolerance.js';

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

  it('allows exactly USD 150.00; USD 150.01 is never allowed alone — it is a near miss for the human', () => {
    expect(evaluatePolicy(withAmount(policyInputFixture(), 15_000)).reasonCode).toBe(
      'ALLOW_WITHIN_MANDATE',
    );
    const over = evaluatePolicy(withAmount(policyInputFixture(), 15_001));
    expect(over.decision).toBe('REQUIRE_HUMAN');
    expect(over.reasonCode).toBe('REQUIRE_HUMAN_AMOUNT');
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

  it('escalates an overage up to the approval ceiling and blocks above it', () => {
    const askUpTo200 = {
      escalation: 'require_human' as const,
      limits: { approvalCeilingMinor: 20_000 },
    };
    const within = evaluatePolicy(withAmount(policyInputFixture({ mandate: askUpTo200 }), 16_800));
    expect(within).toMatchObject({ decision: 'REQUIRE_HUMAN', reasonCode: 'REQUIRE_HUMAN_AMOUNT' });
    expect(within.checks.find((c) => c.code === 'APPROVAL_CEILING')?.passed).toBe(true);

    const above = evaluatePolicy(withAmount(policyInputFixture({ mandate: askUpTo200 }), 30_000));
    expect(above).toMatchObject({ decision: 'BLOCK', reasonCode: 'AMOUNT_EXCEEDED' });
    expect(above.checks.find((c) => c.code === 'APPROVAL_CEILING')?.passed).toBe(false);
  });

  it('hands a near miss on a block plan to the human: 10 % at USD 100 sliding to 7 % at USD 1,000', () => {
    // USD 150 plan → ~9.5 % → ceiling USD 164.20: USD 160 asks, USD 168 blocks
    const near = evaluatePolicy(withAmount(policyInputFixture(), 16_000));
    expect(near).toMatchObject({ decision: 'REQUIRE_HUMAN', reasonCode: 'REQUIRE_HUMAN_AMOUNT' });
    const tol = near.checks.find((c) => c.code === 'APPROVAL_TOLERANCE');
    expect(tol?.passed).toBe(true);
    expect(tol?.expected).toMatchObject({ ceilingMinor: 16_420 });
    const far = evaluatePolicy(withAmount(policyInputFixture(), 16_800));
    expect(far).toMatchObject({ decision: 'BLOCK', reasonCode: 'AMOUNT_EXCEEDED' });
    expect(far.checks.find((c) => c.code === 'APPROVAL_TOLERANCE')?.passed).toBe(false);
  });

  it('tolerance is progressive: 10 % at or under USD 100, 7 % at or over USD 1,000', () => {
    expect(approvalTolerance(5_000)).toEqual({ percent: 10, ceilingMinor: 5_500 });
    expect(approvalTolerance(10_000)).toEqual({ percent: 10, ceilingMinor: 11_000 });
    expect(approvalTolerance(100_000)).toEqual({ percent: 7, ceilingMinor: 107_000 });
    expect(approvalTolerance(1_000_000).percent).toBe(7);
    const mid = approvalTolerance(30_000).percent; // USD 300
    expect(mid).toBeGreaterThan(7);
    expect(mid).toBeLessThan(10);
  });

  it('keeps a departure-time window: outside it asks on an ask-plan and blocks on a block-plan', () => {
    const mornings = { intent: { departureTimeFrom: '06:00', departureTimeTo: '12:00' } };
    const late = { offer: { departureAt: '2026-09-15T23:10:00.000Z' } };
    const inside = evaluatePolicy(policyInputFixture({ mandate: mornings }));
    expect(inside.reasonCode).toBe('ALLOW_WITHIN_MANDATE');
    expect(inside.checks.find((c) => c.code === 'INTENT_TIME')?.passed).toBe(true);
    expect(
      evaluatePolicy(
        policyInputFixture({ ...late, mandate: { ...mornings, escalation: 'require_human' } }),
      ),
    ).toMatchObject({ decision: 'REQUIRE_HUMAN', reasonCode: 'REQUIRE_HUMAN_CONDITION' });
    const blocked = evaluatePolicy(policyInputFixture({ ...late, mandate: mornings }));
    expect(blocked).toMatchObject({ decision: 'BLOCK', reasonCode: 'INTENT_MISMATCH' });
    expect(blocked.checks.find((c) => c.code === 'INTENT_TIME')).toMatchObject({
      passed: false,
      actual: '23:10',
    });
  });

  it('keeps duration and stop limits: a long or connecting itinerary asks or blocks', () => {
    const direct8h = { intent: { maxDurationMinutes: 480, maxStops: 0 } };
    const unknownStops = evaluatePolicy(policyInputFixture({ mandate: direct8h }));
    expect(unknownStops.checks.find((c) => c.code === 'INTENT_STOPS')?.passed).toBe(false);
    // fixture departs 08:00 with no arrival on record: give it a 5 h 30 itinerary
    const arrivalAt = '2026-09-15T13:30:00.000Z';
    const ok = evaluatePolicy(
      policyInputFixture({ mandate: direct8h, offer: { stops: 0, arrivalAt } }),
    );
    expect(ok.reasonCode).toBe('ALLOW_WITHIN_MANDATE');
    const oneStop = evaluatePolicy(
      policyInputFixture({ mandate: direct8h, offer: { stops: 1, arrivalAt } }),
    );
    expect(oneStop).toMatchObject({ decision: 'BLOCK', reasonCode: 'INTENT_MISMATCH' });
    const tooLong = evaluatePolicy(
      policyInputFixture({
        mandate: { ...direct8h, escalation: 'require_human' },
        offer: { stops: 0, arrivalAt: '2026-09-15T22:00:00.000Z' },
      }),
    );
    expect(tooLong).toMatchObject({
      decision: 'REQUIRE_HUMAN',
      reasonCode: 'REQUIRE_HUMAN_CONDITION',
    });
    expect(tooLong.checks.find((c) => c.code === 'INTENT_DURATION')?.passed).toBe(false);
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
    'CLOSED_CHECKOUT_INVALID',
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
