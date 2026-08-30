import { compactVerify, importJWK, SignJWT, decodeProtectedHeader } from 'jose';
import type { Money } from '@authera/contracts';
import type { Ed25519PrivateJwk, Ed25519PublicJwk } from '@authera/domain';

export const CLOSED_CHECKOUT_SCHEMA = 'authera.closed-checkout.v1' as const;
export const CLOSED_CHECKOUT_TYP = 'authera-closed-checkout+jwt' as const;
/** A closed mandate is transaction-specific and short-lived: sign, send, done. */
export const CLOSED_CHECKOUT_TTL_MS = 5 * 60 * 1000;

/**
 * AP2-style *closed* Checkout Mandate: the agent's own signature over the exact transaction it
 * is asking for — mandate, offer, checkout, canonical cart hash and total. The human's *open*
 * mandate (trusted-surface JWS) bounds what may be bought; this binds what is being bought.
 */
export interface ClosedCheckoutClaims {
  schema: typeof CLOSED_CHECKOUT_SCHEMA;
  executionId: string;
  mandateId: string;
  offerId: string;
  checkoutId: string;
  cartHash: string;
  total: Money;
}

export type ClosedCheckoutPayload = Omit<ClosedCheckoutClaims, 'schema'>;

export interface ClosedCheckoutSigner {
  privateJwk: Ed25519PrivateJwk;
  /** RFC 7638 thumbprint of the agent key — the same `keyid` used on the HTTP signature. */
  thumbprint: string;
}

export async function signClosedCheckout(
  signer: ClosedCheckoutSigner,
  payload: ClosedCheckoutPayload,
  now: Date,
): Promise<string> {
  const key = await importJWK(signer.privateJwk as unknown as Record<string, string>, 'EdDSA');
  return new SignJWT({ ...payload, schema: CLOSED_CHECKOUT_SCHEMA })
    .setProtectedHeader({ alg: 'EdDSA', kid: signer.thumbprint, typ: CLOSED_CHECKOUT_TYP })
    .setIssuer(`authera:agent:${signer.thumbprint}`)
    .setAudience('authera:gateway')
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor((now.getTime() + CLOSED_CHECKOUT_TTL_MS) / 1000))
    .sign(key);
}

export type ClosedCheckoutVerification =
  { ok: true; claims: ClosedCheckoutClaims; kid: string } | { ok: false; reason: string };

/**
 * Verifies the closed mandate against the key the HTTP signature already proved, then checks
 * every claim against the server's own records. Any mismatch is a hard failure: an agent may
 * only ever be charged for exactly what it signed.
 */
export async function verifyClosedCheckout(
  jws: string,
  agent: { thumbprint: string; publicJwk: Ed25519PublicJwk },
  expected: ClosedCheckoutPayload,
  now: Date,
): Promise<ClosedCheckoutVerification> {
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(jws);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (header.alg !== 'EdDSA' || header.typ !== CLOSED_CHECKOUT_TYP) {
    return { ok: false, reason: 'unexpected header' };
  }
  if (header.kid !== agent.thumbprint) return { ok: false, reason: 'kid is not the request key' };

  let claims: Record<string, unknown>;
  try {
    const key = await importJWK(agent.publicJwk as unknown as Record<string, string>, 'EdDSA');
    const verified = await compactVerify(jws, key, { algorithms: ['EdDSA'] });
    claims = JSON.parse(new TextDecoder().decode(verified.payload)) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'signature invalid' };
  }

  const nowSeconds = now.getTime() / 1000;
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds)
    return { ok: false, reason: 'expired' };
  if (typeof claims.iat !== 'number' || claims.iat > nowSeconds + 60)
    return { ok: false, reason: 'issued in the future' };
  if (claims.aud !== 'authera:gateway') return { ok: false, reason: 'wrong audience' };
  if (claims.iss !== `authera:agent:${agent.thumbprint}`)
    return { ok: false, reason: 'wrong issuer' };
  if (claims.schema !== CLOSED_CHECKOUT_SCHEMA) return { ok: false, reason: 'wrong schema' };

  const total = claims.total as Partial<Money> | undefined;
  const mismatches = (
    [
      ['executionId', claims.executionId === expected.executionId],
      ['mandateId', claims.mandateId === expected.mandateId],
      ['offerId', claims.offerId === expected.offerId],
      ['checkoutId', claims.checkoutId === expected.checkoutId],
      ['cartHash', claims.cartHash === expected.cartHash],
      [
        'total',
        total?.currency === expected.total.currency && total?.minor === expected.total.minor,
      ],
    ] as const
  )
    .filter(([, ok]) => !ok)
    .map(([field]) => field);
  if (mismatches.length > 0)
    return { ok: false, reason: `binding mismatch: ${mismatches.join(', ')}` };

  return {
    ok: true,
    kid: header.kid,
    claims: {
      schema: CLOSED_CHECKOUT_SCHEMA,
      executionId: expected.executionId,
      mandateId: expected.mandateId,
      offerId: expected.offerId,
      checkoutId: expected.checkoutId,
      cartHash: expected.cartHash,
      total: expected.total,
    },
  };
}
