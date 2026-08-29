import { describe, expect, it } from 'vitest';
import { createPrivateKey, sign, verify } from 'node:crypto';
import { ed25519FromPrivateJwk, ed25519FromSeed, jwkThumbprint, seedFromSecret } from './keys.js';

describe('Ed25519 key helpers', () => {
  it('derives the same key pair from the same seed, different ones from different purposes', () => {
    const a = ed25519FromSeed(seedFromSecret('secret', 'agent'), 'agent');
    const b = ed25519FromSeed(seedFromSecret('secret', 'agent'), 'agent');
    const c = ed25519FromSeed(seedFromSecret('secret', 'merchant'), 'merchant');
    expect(a.publicJwk).toEqual(b.publicJwk);
    expect(a.thumbprint).toBe(b.thumbprint);
    expect(a.thumbprint).not.toBe(c.thumbprint);
    expect(a.kid).toMatch(/^agent-/);
  });

  it('produces a usable signing key and a matching public key', () => {
    const pair = ed25519FromSeed(seedFromSecret('secret', 'trusted-surface'), 'ts');
    const privateKey = createPrivateKey({
      key: pair.privateJwk as unknown as Record<string, string>,
      format: 'jwk',
    });
    const signature = sign(null, Buffer.from('hello'), privateKey);
    const publicKey = {
      key: pair.publicJwk as unknown as Record<string, string>,
      format: 'jwk' as const,
    };
    expect(verify(null, Buffer.from('hello'), publicKey, signature)).toBe(true);
    expect(verify(null, Buffer.from('tampered'), publicKey, signature)).toBe(false);
  });

  it('round-trips through a private JWK and computes a stable RFC 7638 thumbprint', () => {
    const pair = ed25519FromSeed(seedFromSecret('secret', 'agent'), 'agent');
    const imported = ed25519FromPrivateJwk(pair.privateJwk, 'agent');
    expect(imported.publicJwk.x).toBe(pair.publicJwk.x);
    expect(imported.thumbprint).toBe(pair.thumbprint);
    expect(jwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: pair.publicJwk.x, kid: 'ignored' })).toBe(
      pair.thumbprint,
    );
  });

  it('rejects seeds of the wrong length', () => {
    expect(() => ed25519FromSeed(new Uint8Array(16), 'x')).toThrow(TypeError);
  });
});
