import { createHash } from 'node:crypto';
import { decodeJwt, importJWK, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import type { EvidenceBundle } from '@authera/contracts';
import { loadKeyMaterial } from '@authera/domain';
import { fixedClock } from '../clock.js';
import { Ap2EvidenceService } from './ap2-evidence.js';

const EXECUTION_ID = '00000000-0000-4000-8000-000000000001';
const CHECKOUT_ID = '00000000-0000-4000-8000-000000000002';
const MANDATE_ID = '00000000-0000-4000-8000-000000000003';

function evidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    evidenceId: 'evidence-1',
    executionId: EXECUTION_ID,
    execution: {
      decision: 'ALLOW',
      reasonCode: 'ALLOW_WITHIN_MANDATE',
    },
    agent: { keyThumbprint: 'agent-thumbprint' },
    human: { authorization: { policyHash: 'policy-hash' } },
    mandate: {
      policy: {
        mandateId: MANDATE_ID,
        version: 1,
        paymentMethodRef: 'tok_ref_secret',
      },
    },
    checkout: {
      id: CHECKOUT_ID,
      bound: true,
      cartHash: 'cart-hash',
      cart: {
        schema: 'authera.cart.v1',
        merchantId: '00000000-0000-4000-8000-000000000004',
        offerId: '00000000-0000-4000-8000-000000000005',
        lineItems: [
          {
            offerId: '00000000-0000-4000-8000-000000000005',
            description: 'Flight',
            quantity: 1,
            unitPrice: { currency: 'USD', minor: 13_000 },
          },
        ],
        total: { currency: 'USD', minor: 13_000 },
      },
    },
    payment: {
      id: '00000000-0000-4000-8000-000000000006',
      providerPaymentId: 'provider-payment-1',
      providerTransactionId: 'transaction-1',
      amount: { currency: 'USD', minor: 13_000 },
    },
    audit: { chain: { valid: true }, events: [{ hash: 'audit-root' }] },
    bundleHash: 'bundle-hash',
    ...overrides,
  } as EvidenceBundle;
}

describe('AP2 v0.2-aligned evidence', () => {
  it('signs checkout and evidence bindings while labeling unsupported AP2 features', async () => {
    const keys = loadKeyMaterial({ demoSecret: 'ap2-evidence-test' });
    const service = new Ap2EvidenceService({
      evidence: { bundle: async () => evidence() },
      merchantKey: keys.merchant,
      clock: fixedClock('2026-08-29T15:00:00.000Z'),
    });

    const envelope = await service.envelope(EXECUTION_ID);
    expect(envelope.payload.alignment).toMatchObject({ certified: false, version: '0.2' });
    expect(envelope.payload.alignment.label).toContain('not certified');
    expect(envelope.payload.checkout.vct).toBe('mandate.checkout.1');
    expect(envelope.payload.payment?.vct).toBe('mandate.payment.1');
    expect(envelope.payload.payment?.payment_method_reference_hash).not.toContain('tok_ref');
    expect(envelope.payload.checkout.checkout_hash).toBe(
      createHash('sha256').update(envelope.payload.checkout.checkout_jwt).digest('base64url'),
    );

    const publicKey = await importJWK(
      keys.merchant.publicJwk as unknown as Record<string, string>,
      'EdDSA',
    );
    await expect(
      jwtVerify(envelope.jws, publicKey, {
        issuer: 'authera:merchant:vuelaya',
        audience: 'ap2:dispute-evidence',
        typ: 'authera-ap2-aligned+jwt',
      }),
    ).resolves.toBeDefined();
    expect(decodeJwt(envelope.jws).execution_id).toBe(EXECUTION_ID);
  });

  it('refuses to sign an unbound checkout or broken audit chain', async () => {
    const service = new Ap2EvidenceService({
      evidence: {
        bundle: async () =>
          evidence({
            checkout: { ...evidence().checkout!, bound: false },
            audit: { ...evidence().audit, chain: { ...evidence().audit.chain, valid: false } },
          }),
      },
      merchantKey: loadKeyMaterial({ demoSecret: 'ap2-invalid-test' }).merchant,
      clock: fixedClock('2026-08-29T15:00:00.000Z'),
    });

    await expect(service.envelope(EXECUTION_ID)).rejects.toMatchObject({
      code: 'AP2_EVIDENCE_UNVERIFIED',
    });
  });
});
