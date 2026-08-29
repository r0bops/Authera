import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PolicyVerdictSchema, type PolicyInput } from '@agentcerta/contracts';
import { policyInputFixture } from '@agentcerta/test-support';
import { evaluatePolicy } from './evaluate.js';

const amountArb = fc.integer({ min: 0, max: 60_000 });
const escalationArb = fc.constantFrom('block', 'require_human' as const);
const runtimeStatusArb = fc.constantFrom(
  'ACTIVE',
  'REVOKED',
  'EXPIRED',
  'SUPERSEDED',
  'DRAFT' as const,
);

function build(
  amount: number,
  escalation: 'block' | 'require_human',
  approval: boolean,
): PolicyInput {
  const input = policyInputFixture({ mandate: { escalation } });
  const withAmount: PolicyInput = {
    ...input,
    offer: { ...input.offer, total: { currency: 'USD', minor: amount } },
    checkout: { ...input.checkout, total: { currency: 'USD', minor: amount } },
  };
  return approval
    ? {
        ...withAmount,
        checkoutScopedApproval: {
          checkoutHash: input.checkout.hash,
          expiresAt: '2026-08-30T13:00:00.000Z',
          status: 'ACTIVE',
        },
      }
    : withAmount;
}

describe('evaluatePolicy properties', () => {
  it('raising the requested amount can never turn BLOCK into ALLOW for the same mandate', () => {
    fc.assert(
      fc.property(
        amountArb,
        amountArb,
        escalationArb,
        fc.boolean(),
        (a, b, escalation, approval) => {
          const [low, high] = a <= b ? [a, b] : [b, a];
          const lowVerdict = evaluatePolicy(build(low, escalation, approval));
          const highVerdict = evaluatePolicy(build(high, escalation, approval));
          return !(lowVerdict.decision === 'BLOCK' && highVerdict.decision === 'ALLOW');
        },
      ),
    );
  });

  it('revoked, expired, superseded, or draft mandates never allow', () => {
    fc.assert(
      fc.property(amountArb, runtimeStatusArb, fc.boolean(), (amount, status, approval) => {
        fc.pre(status !== 'ACTIVE');
        const input = {
          ...build(amount, 'require_human', approval),
          runtime: { ...build(amount, 'block', false).runtime, status },
        };
        return evaluatePolicy(input).decision !== 'ALLOW';
      }),
    );
  });

  it('a clock at or past validUntil never allows', () => {
    fc.assert(
      fc.property(amountArb, fc.integer({ min: 0, max: 10_000_000 }), (amount, offsetMs) => {
        const input = build(amount, 'block', true);
        const now = new Date(Date.parse(input.mandate.validUntil) + offsetMs).toISOString();
        return evaluatePolicy({ ...input, now }).decision !== 'ALLOW';
      }),
    );
  });

  it('unknown constraints anywhere in the mandate never allow', () => {
    const keyArb = fc.string({ minLength: 1, maxLength: 12 }).filter((k) => /^[a-zA-Z]+$/.test(k));
    const valueArb = fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(true));
    fc.assert(
      fc.property(
        keyArb,
        valueArb,
        fc.constantFrom('mandate', 'limits', 'intent' as const),
        (key, value, where) => {
          const input = policyInputFixture();
          const mandate: Record<string, unknown> = { ...input.mandate };
          if (where === 'mandate') {
            fc.pre(!(key in mandate));
            mandate[key] = value;
          } else {
            const nested: Record<string, unknown> = {
              ...(input.mandate[where] as Record<string, unknown>),
            };
            fc.pre(!(key in nested));
            nested[key] = value;
            mandate[where] = nested;
          }
          const verdict = evaluatePolicy({ ...input, mandate });
          return verdict.decision === 'BLOCK' && verdict.reasonCode === 'INTERNAL_FAIL_CLOSED';
        },
      ),
    );
  });

  it('always returns a schema-valid verdict without throwing, even for hostile input', () => {
    fc.assert(
      fc.property(fc.anything(), (anything) => {
        const verdict = evaluatePolicy(anything);
        expect(PolicyVerdictSchema.safeParse(verdict).success).toBe(true);
        return verdict.decision === 'BLOCK';
      }),
    );
  });
});
