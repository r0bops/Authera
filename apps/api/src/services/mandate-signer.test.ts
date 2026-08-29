import { describe, expect, it } from 'vitest';
import { loadKeyMaterial } from '@agentcerta/domain';
import { mandatePolicyFixture } from '@agentcerta/test-support';
import { MandateSigner, verifyMandateJws } from './mandate-signer.js';

const keys = loadKeyMaterial({ demoSecret: 'signer-test-secret' });
const other = loadKeyMaterial({ demoSecret: 'another-secret' });
const NOW = new Date('2026-08-30T12:00:00.000Z');
const policy = mandatePolicyFixture({ agentKeyThumbprint: keys.agent.thumbprint });

const resolver = (kid: string) =>
  Promise.resolve(kid === keys.trustedSurface.kid ? keys.trustedSurface.publicJwk : undefined);

describe('mandate JWS', () => {
  it('signs a canonical policy and verifies it with the trusted-surface public key', async () => {
    const signed = await new MandateSigner(keys.trustedSurface).sign(policy, NOW);
    expect(signed.kid).toBe(keys.trustedSurface.kid);
    const result = await verifyMandateJws(signed.jws, resolver, {
      now: NOW,
      expectedMandateId: policy.mandateId,
    });
    expect(result).toMatchObject({ ok: true, policyHash: signed.policyHash, kid: signed.kid });
    if (result.ok) expect(result.policy).toEqual(policy);
  });

  it('rejects unknown keys, other signers, tampering, and wrong mandate ids', async () => {
    const signed = await new MandateSigner(keys.trustedSurface).sign(policy, NOW);
    expect(
      await verifyMandateJws(signed.jws, () => Promise.resolve(undefined), { now: NOW }),
    ).toEqual({ ok: false, reason: 'unknown_key' });
    const forged = await new MandateSigner(other.trustedSurface).sign(policy, NOW);
    expect(
      await verifyMandateJws(forged.jws, () => Promise.resolve(keys.trustedSurface.publicJwk), {
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'signature' });
    const [h, p, s] = signed.jws.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(p!, 'base64url').toString()),
        policyHash: 'sha256:evil',
      }),
    ).toString('base64url');
    expect(await verifyMandateJws(`${h}.${tamperedPayload}.${s}`, resolver, { now: NOW })).toEqual({
      ok: false,
      reason: 'signature',
    });
    expect(
      await verifyMandateJws(signed.jws, resolver, {
        now: NOW,
        expectedMandateId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toEqual({ ok: false, reason: 'claims' });
    expect(await verifyMandateJws('not-a-jws', resolver, { now: NOW })).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('reports expiry and not-yet-valid against the supplied clock, not the wall clock', async () => {
    const signed = await new MandateSigner(keys.trustedSurface).sign(policy, NOW);
    expect(
      await verifyMandateJws(signed.jws, resolver, { now: new Date('2026-09-02T00:00:00.000Z') }),
    ).toEqual({ ok: false, reason: 'expired' });
    expect(
      await verifyMandateJws(signed.jws, resolver, { now: new Date('2026-08-01T00:00:00.000Z') }),
    ).toEqual({ ok: false, reason: 'not_yet_valid' });
  });

  it('binds the agent key: a policy whose thumbprint changed after signing fails', async () => {
    const signed = await new MandateSigner(keys.trustedSurface).sign(policy, NOW);
    const [h, p, s] = signed.jws.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    payload.cnf = { jkt: other.agent.thumbprint };
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    expect((await verifyMandateJws(forged, resolver, { now: NOW })).ok).toBe(false);
  });
});
