import { describe, expect, it } from 'vitest';
import { resolveDisputeFromEvidence, type DisputeEvidence } from './dispute.js';

function evidence(overrides: Partial<DisputeEvidence> = {}): DisputeEvidence {
  return {
    executionId: '4c0f2c2e-2b2e-4b6c-8a5e-7c8c1e6b9a11',
    executionState: 'SUCCEEDED',
    decision: 'ALLOW',
    reasonCode: 'ALLOW_WITHIN_MANDATE',
    checks: [
      { code: 'AGENT_BOUND', passed: true },
      { code: 'CHECKOUT_INTEGRITY', passed: true },
      { code: 'AMOUNT_PER_PURCHASE', passed: true },
    ],
    mandate: {
      id: 'm1',
      version: 1,
      status: 'REVOKED',
      createdAt: '2026-08-30T10:00:00.000Z',
      revokedAt: '2026-08-30T12:30:00.000Z',
    },
    mandateSignatureValid: true,
    checkoutBound: true,
    approval: null,
    reservation: { state: 'CONSUMED', createdAt: '2026-08-30T12:00:00.000Z' },
    payment: {
      state: 'SUCCEEDED',
      providerPaymentId: 'mock_pay_1',
      updatedAt: '2026-08-30T12:00:01.000Z',
    },
    chainValid: true,
    reason: 'REVOKED_BEFORE_PURCHASE',
    ...overrides,
  };
}

describe('resolveDisputeFromEvidence', () => {
  it('upholds an authorized purchase when revocation came after the committed reservation', () => {
    const resolution = resolveDisputeFromEvidence(evidence());
    expect(resolution.outcome).toBe('AUTHORIZED');
    expect(resolution.headline).toBe('Purchase was authorized');
    expect(resolution.timeline.map((t) => t.label)).toEqual([
      'Mandate created and signed',
      'Mandate usage reserved',
      'Payment succeeded',
      'Mandate revoked',
    ]);
    expect(resolution.findings.find((f) => f.label === 'Revocation after the purchase')?.ok).toBe(
      true,
    );
  });

  it('supports the customer when revocation preceded the reservation', () => {
    const resolution = resolveDisputeFromEvidence(
      evidence({
        mandate: {
          id: 'm1',
          version: 1,
          status: 'REVOKED',
          createdAt: '2026-08-30T10:00:00.000Z',
          revokedAt: '2026-08-30T11:59:00.000Z',
        },
      }),
    );
    expect(resolution.outcome).toBe('CUSTOMER_SUPPORTED');
  });

  it('supports the customer when no valid mandate or cart binding exists behind a successful payment', () => {
    expect(resolveDisputeFromEvidence(evidence({ mandate: null })).outcome).toBe(
      'CUSTOMER_SUPPORTED',
    );
    expect(resolveDisputeFromEvidence(evidence({ mandateSignatureValid: false })).outcome).toBe(
      'CUSTOMER_SUPPORTED',
    );
    expect(resolveDisputeFromEvidence(evidence({ checkoutBound: false })).outcome).toBe(
      'CUSTOMER_SUPPORTED',
    );
    expect(
      resolveDisputeFromEvidence(evidence({ checks: [{ code: 'AGENT_BOUND', passed: false }] }))
        .outcome,
    ).toBe('CUSTOMER_SUPPORTED');
  });

  it('records "no charge occurred" for blocked or failed executions', () => {
    const blocked = resolveDisputeFromEvidence(
      evidence({
        executionState: 'BLOCKED',
        decision: 'BLOCK',
        reasonCode: 'AMOUNT_EXCEEDED',
        payment: null,
        reservation: null,
      }),
    );
    expect(blocked.outcome).toBe('CUSTOMER_SUPPORTED');
    expect(blocked.headline).toBe('No charge occurred');
    expect(blocked.explanation).toContain('AMOUNT_EXCEEDED');
  });

  it('escalates when the chain does not verify or the record is inconsistent', () => {
    expect(resolveDisputeFromEvidence(evidence({ chainValid: false })).outcome).toBe('UNRESOLVED');
    expect(resolveDisputeFromEvidence(evidence({ reasonCode: 'AMOUNT_EXCEEDED' })).outcome).toBe(
      'UNRESOLVED',
    );
  });

  it('treats a consumed checkout-scoped approval as authorization', () => {
    const resolution = resolveDisputeFromEvidence(
      evidence({
        reasonCode: 'ALLOW_CHECKOUT_APPROVAL',
        approval: {
          state: 'CONSUMED',
          checkoutHash: 'sha256:abc',
          decidedAt: '2026-08-30T11:50:00.000Z',
        },
        mandate: {
          id: 'm1',
          version: 1,
          status: 'ACTIVE',
          createdAt: '2026-08-30T10:00:00.000Z',
          revokedAt: null,
        },
      }),
    );
    expect(resolution.outcome).toBe('AUTHORIZED');
    expect(
      resolution.findings.find((f) => f.label === 'Purchase within the mandate')?.detail,
    ).toContain('explicitly approved');
  });
});
