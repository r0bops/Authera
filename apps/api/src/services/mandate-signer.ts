import { importJWK, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { MANDATE_SCHEMA_ID, MandatePolicyV1Schema, type MandatePolicyV1 } from '@authera/contracts';
import { hashCanonical, type Ed25519PublicJwk, type KeyPair } from '@authera/domain';

export const MANDATE_JWS_TYPE = 'authera-mandate+jwt';
export const MANDATE_ISSUER = 'authera:trusted-surface';
export const MANDATE_AUDIENCE = 'authera:gateway';

export interface SignedMandate {
  jws: string;
  policyHash: string;
  kid: string;
}

/**
 * The trusted surface signs the canonical policy (spec §11). The JWS proves integrity and
 * the human's authorization; PostgreSQL `mandate_runtime` proves current validity.
 */
export class MandateSigner {
  constructor(private readonly key: KeyPair) {}

  get kid(): string {
    return this.key.kid;
  }

  async sign(policy: MandatePolicyV1, now: Date): Promise<SignedMandate> {
    const parsed = MandatePolicyV1Schema.parse(policy);
    const policyHash = hashCanonical(parsed);
    const privateKey = await importJWK(
      this.key.privateJwk as unknown as Record<string, string>,
      'EdDSA',
    );
    const jws = await new SignJWT({
      schema: MANDATE_SCHEMA_ID,
      policyHash,
      policy: parsed,
      cnf: { jkt: parsed.agentKeyThumbprint },
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.key.kid, typ: MANDATE_JWS_TYPE })
      .setIssuer(MANDATE_ISSUER)
      .setAudience(MANDATE_AUDIENCE)
      .setSubject(parsed.mandateId)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setNotBefore(Math.floor(Date.parse(parsed.validFrom) / 1000))
      .setExpirationTime(Math.floor(Date.parse(parsed.validUntil) / 1000))
      .sign(privateKey);
    return { jws, policyHash, kid: this.key.kid };
  }
}

export type MandateVerification =
  | { ok: true; policy: MandatePolicyV1; policyHash: string; kid: string }
  | {
      ok: false;
      reason: 'unknown_key' | 'signature' | 'expired' | 'not_yet_valid' | 'claims' | 'policy';
    };

export type KeyResolver = (kid: string) => Promise<Ed25519PublicJwk | undefined>;

/**
 * Verify a mandate JWS with application-level checks the library does not make (spec §11):
 * exact algorithm, known kid, issuer/audience, typ, schema, canonical policy hash, agent-key
 * confirmation binding, subject = mandate id, validity window at the supplied clock.
 */
export async function verifyMandateJws(
  jws: string,
  resolveKey: KeyResolver,
  options: { now: Date; expectedMandateId?: string },
): Promise<MandateVerification> {
  let kid: string | undefined;
  try {
    const [rawHeader] = jws.split('.');
    if (!rawHeader) return { ok: false, reason: 'signature' };
    const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      header.alg !== 'EdDSA' ||
      header.typ !== MANDATE_JWS_TYPE ||
      typeof header.kid !== 'string'
    ) {
      return { ok: false, reason: 'claims' };
    }
    kid = header.kid;
  } catch {
    return { ok: false, reason: 'signature' };
  }
  const jwk = await resolveKey(kid);
  if (!jwk) return { ok: false, reason: 'unknown_key' };

  let payload: JWTPayload;
  try {
    const publicKey = await importJWK(jwk as unknown as Record<string, string>, 'EdDSA');
    const result = await jwtVerify(jws, publicKey, {
      algorithms: ['EdDSA'],
      issuer: MANDATE_ISSUER,
      audience: MANDATE_AUDIENCE,
      typ: MANDATE_JWS_TYPE,
      currentDate: options.now,
      clockTolerance: 5,
    });
    payload = result.payload;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_JWT_EXPIRED') return { ok: false, reason: 'expired' };
    if (
      code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' &&
      String((error as Error).message).includes('"nbf"')
    ) {
      return { ok: false, reason: 'not_yet_valid' };
    }
    if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') return { ok: false, reason: 'claims' };
    return { ok: false, reason: 'signature' };
  }

  if (payload.schema !== MANDATE_SCHEMA_ID) return { ok: false, reason: 'claims' };
  const policyParse = MandatePolicyV1Schema.safeParse(payload.policy);
  if (!policyParse.success) return { ok: false, reason: 'policy' };
  const policy = policyParse.data;
  const policyHash = hashCanonical(policy);
  if (payload.policyHash !== policyHash) return { ok: false, reason: 'policy' };
  const cnf = payload.cnf as { jkt?: unknown } | undefined;
  if (!cnf || cnf.jkt !== policy.agentKeyThumbprint) return { ok: false, reason: 'claims' };
  if (payload.sub !== policy.mandateId) return { ok: false, reason: 'claims' };
  if (options.expectedMandateId && options.expectedMandateId !== policy.mandateId)
    return { ok: false, reason: 'claims' };
  return { ok: true, policy, policyHash, kid };
}
