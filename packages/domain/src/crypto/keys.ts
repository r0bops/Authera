import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { canonicalJson } from './canonical.js';

/** Minimal OKP/Ed25519 JWK shapes used across the system. */
export interface Ed25519PublicJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid?: string;
  alg?: 'EdDSA';
  use?: 'sig';
}

export interface Ed25519PrivateJwk extends Ed25519PublicJwk {
  d: string;
}

export interface KeyPair {
  kid: string;
  thumbprint: string;
  publicJwk: Ed25519PublicJwk;
  privateJwk: Ed25519PrivateJwk;
}

// PKCS#8 DER prefix for an Ed25519 private key (RFC 8410); the 32-byte seed follows.
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * RFC 7638 JWK thumbprint (base64url SHA-256 over the canonical required members).
 * Used as the stable `kid` for agent keys and as the mandate's agent-key binding.
 */
export function jwkThumbprint(jwk: Ed25519PublicJwk): string {
  const required = { crv: jwk.crv, kty: jwk.kty, x: jwk.x };
  return createHash('sha256').update(canonicalJson(required)).digest('base64url');
}

/** Derive a deterministic Ed25519 key pair from a 32-byte seed. */
export function ed25519FromSeed(seed: Uint8Array, kidPrefix: string): KeyPair {
  if (seed.byteLength !== 32) throw new TypeError('Ed25519 seed must be exactly 32 bytes');
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  });
  return keyPairFromPrivate(privateKey, kidPrefix);
}

/** Import a private JWK ({ kty: 'OKP', crv: 'Ed25519', d, x }). */
export function ed25519FromPrivateJwk(jwk: Ed25519PrivateJwk, kidPrefix: string): KeyPair {
  const privateKey = createPrivateKey({
    key: jwk as unknown as Record<string, string>,
    format: 'jwk',
  });
  return keyPairFromPrivate(privateKey, kidPrefix, jwk.kid);
}

/** Derive a purpose-specific 32-byte seed from a shared secret (HKDF-like, SHA-256). */
export function seedFromSecret(secret: string, purpose: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(`authera-key:${purpose}:${secret}`).digest());
}

export function publicJwkOf(pair: KeyPair): Ed25519PublicJwk {
  return { ...pair.publicJwk };
}

function keyPairFromPrivate(
  privateKey: KeyObject,
  kidPrefix: string,
  explicitKid?: string,
): KeyPair {
  const exported = privateKey.export({ format: 'jwk' }) as Record<string, string>;
  const publicExported = createPublicKey(privateKey).export({ format: 'jwk' }) as Record<
    string,
    string
  >;
  if (exported.kty !== 'OKP' || exported.crv !== 'Ed25519' || !exported.d || !publicExported.x) {
    throw new TypeError('not an Ed25519 key');
  }
  const publicJwk: Ed25519PublicJwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    x: publicExported.x,
    alg: 'EdDSA',
    use: 'sig',
  };
  const thumbprint = jwkThumbprint(publicJwk);
  const kid = explicitKid ?? `${kidPrefix}-${thumbprint.slice(0, 16)}`;
  publicJwk.kid = kid;
  return {
    kid,
    thumbprint,
    publicJwk,
    privateJwk: { ...publicJwk, d: exported.d },
  };
}

export interface KeyMaterialInput {
  trustedSurfacePrivateJwk?: string | undefined;
  merchantPrivateJwk?: string | undefined;
  agentPrivateJwk?: string | undefined;
  /** Demo-only: derive missing keys deterministically from this secret. */
  demoSecret?: string | undefined;
}

export interface KeyMaterial {
  trustedSurface: KeyPair;
  merchant: KeyPair;
  agent: KeyPair;
  /** True when at least one key was derived from the demo secret instead of an explicit JWK. */
  derived: boolean;
}

/**
 * Resolve the three signing roles (spec §11). Explicit private JWKs win; in demo mode any
 * missing key is derived from the demo secret so the offline demo needs no key files.
 * Outside demo mode every key must be explicit.
 */
export function loadKeyMaterial(input: KeyMaterialInput): KeyMaterial {
  let derived = false;
  const resolve = (jwkJson: string | undefined, purpose: string, kidPrefix: string): KeyPair => {
    if (jwkJson) {
      const parsed = JSON.parse(jwkJson) as Ed25519PrivateJwk;
      if (parsed.kty !== 'OKP' || parsed.crv !== 'Ed25519' || !parsed.d) {
        throw new TypeError(`${purpose} private JWK must be an Ed25519 OKP key with "d"`);
      }
      return ed25519FromPrivateJwk(parsed, kidPrefix);
    }
    if (!input.demoSecret) {
      throw new Error(`${purpose} private JWK is required when no demo secret is configured`);
    }
    derived = true;
    return ed25519FromSeed(seedFromSecret(input.demoSecret, purpose), kidPrefix);
  };
  return {
    trustedSurface: resolve(input.trustedSurfacePrivateJwk, 'trusted-surface', 'ts'),
    merchant: resolve(input.merchantPrivateJwk, 'merchant', 'merchant'),
    agent: resolve(input.agentPrivateJwk, 'agent', 'agent'),
    derived,
  };
}
