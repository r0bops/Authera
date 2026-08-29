import { describe, expect, it } from 'vitest';
import type { PolicyInput } from '@authera/contracts';
import { policyInputFixture } from '@authera/test-support';
import { evaluatePolicy } from './evaluate.js';

/** A goods mandate ("wool runner", up to 2) with a matching goods offer. */
function goodsInput(overrides: {
  offer?: Partial<PolicyInput['offer']>;
  query?: string;
  maxQuantity?: number;
}): PolicyInput {
  const base = policyInputFixture();
  return {
    ...base,
    mandate: {
      ...base.mandate,
      intent: {
        type: 'goods',
        query: overrides.query ?? 'wool runner',
        maxQuantity: overrides.maxQuantity ?? 2,
      },
    },
    offer: {
      id: base.offer.id,
      kind: 'goods',
      merchantId: base.offer.merchantId,
      title: "Men's Wool Runner — Natural Black",
      quantity: 1,
      searchQuery: 'wool runner',
      total: base.offer.total,
      status: 'AVAILABLE',
      ...overrides.offer,
    },
  };
}

function failed(verdict: ReturnType<typeof evaluatePolicy>): string | undefined {
  return verdict.checks.find((c) => !c.passed)?.code;
}

describe('evaluatePolicy — goods intents', () => {
  it('allows a product discovered under the mandate query within quantity and amount', () => {
    const verdict = evaluatePolicy(goodsInput({}));
    expect(verdict.decision).toBe('ALLOW');
    expect(verdict.checks.map((c) => c.code)).toEqual(
      expect.arrayContaining(['INTENT_KIND', 'INTENT_QUERY', 'INTENT_QUANTITY']),
    );
    expect(verdict.checks.some((c) => c.code === 'INTENT_ROUTE')).toBe(false);
  });

  it('compares the query case- and whitespace-insensitively', () => {
    const verdict = evaluatePolicy(goodsInput({ offer: { searchQuery: '  Wool   RUNNER ' } }));
    expect(verdict.decision).toBe('ALLOW');
  });

  it('blocks an offer discovered under a different search, even if cheaper', () => {
    const verdict = evaluatePolicy(goodsInput({ offer: { searchQuery: 'tree dasher' } }));
    expect(verdict.decision).toBe('BLOCK');
    expect(verdict.reasonCode).toBe('INTENT_MISMATCH');
    expect(failed(verdict)).toBe('INTENT_QUERY');
  });

  it('blocks an offer with no recorded search query (the agent cannot relabel an offer)', () => {
    const input = goodsInput({});
    delete (input.offer as { searchQuery?: string }).searchQuery;
    const verdict = evaluatePolicy(input);
    expect(verdict.decision).toBe('BLOCK');
    expect(failed(verdict)).toBe('INTENT_QUERY');
  });

  it('blocks quantities above the mandate maximum', () => {
    const verdict = evaluatePolicy(goodsInput({ offer: { quantity: 3 }, maxQuantity: 2 }));
    expect(verdict.decision).toBe('BLOCK');
    expect(failed(verdict)).toBe('INTENT_QUANTITY');
  });

  it('blocks a flight offer against a goods mandate and vice versa', () => {
    const flightAgainstGoods = goodsInput({ offer: { kind: 'flight' } });
    expect(evaluatePolicy(flightAgainstGoods).decision).toBe('BLOCK');
    expect(failed(evaluatePolicy(flightAgainstGoods))).toBe('INTENT_KIND');

    const base = policyInputFixture();
    const goodsAgainstFlight: PolicyInput = {
      ...base,
      offer: { ...base.offer, kind: 'goods', title: 'Socks', searchQuery: 'socks' },
    };
    expect(evaluatePolicy(goodsAgainstFlight).decision).toBe('BLOCK');
    expect(failed(evaluatePolicy(goodsAgainstFlight))).toBe('INTENT_KIND');
  });

  it('still enforces money limits on goods (over cap escalates or blocks, never allows)', () => {
    const input = goodsInput({});
    input.checkout = { ...input.checkout, total: { currency: 'USD', minor: 99_000 } };
    input.offer = { ...input.offer, total: { currency: 'USD', minor: 99_000 } };
    const verdict = evaluatePolicy(input);
    expect(verdict.decision).not.toBe('ALLOW');
    expect(['AMOUNT_EXCEEDED', 'REQUIRE_HUMAN_AMOUNT']).toContain(verdict.reasonCode);
  });
});
