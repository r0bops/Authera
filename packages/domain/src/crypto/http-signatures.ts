import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import type { Ed25519PrivateJwk, Ed25519PublicJwk } from './keys.js';

/**
 * RFC 9421 HTTP Message Signatures (Ed25519) with the Web Bot Auth profile used by Authera.
 *
 * In-house rather than the `web-bot-auth` SDK because that SDK's `signatureHeaders` fixes the
 * covered components to `@authority`, while the gateway requires
 * `@method @authority @path content-digest signature-agent ucp-agent` (spec §11).
 * The signature base and parameter serialization follow RFC 9421 §2.
 */

export const REQUIRED_COMPONENTS = [
  '@method',
  '@authority',
  '@path',
  'content-digest',
  'signature-agent',
  'ucp-agent',
] as const;

export const SIGNATURE_LABEL = 'sig1';
export const DEFAULT_MAX_LIFETIME_SEC = 300;
export const DEFAULT_CLOCK_SKEW_SEC = 30;

export interface SignableRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface SignatureParams {
  components: string[];
  created: number;
  expires: number;
  keyid: string;
  nonce: string;
  tag: string;
}

export interface SignOptions {
  privateJwk: Ed25519PrivateJwk;
  keyid: string;
  tag: string;
  nonce: string;
  created: Date;
  expires: Date;
  /** Agent profile URI, sent as a quoted sf-string in `Signature-Agent`. */
  signatureAgent: string;
  /** `UCP-Agent` header value, e.g. `profile="https://…"`. */
  ucpAgent: string;
  components?: string[];
}

export interface SignedHeaders {
  'content-digest': string;
  'signature-agent': string;
  'ucp-agent': string;
  'signature-input': string;
  signature: string;
}

export function contentDigest(body: Uint8Array): string {
  return `sha-256=:${createHash('sha256').update(body).digest('base64')}:`;
}

function authorityOf(url: URL): string {
  const defaultPort =
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80');
  return defaultPort ? url.hostname.toLowerCase() : url.host.toLowerCase();
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value.trim().replace(/\s+/g, ' ');
  }
  return undefined;
}

function componentValue(request: SignableRequest, name: string): string | undefined {
  const url = new URL(request.url);
  switch (name) {
    case '@method':
      return request.method.toUpperCase();
    case '@authority':
      return authorityOf(url);
    case '@path':
      return url.pathname || '/';
    case '@target-uri':
      return url.toString();
    default:
      return name.startsWith('@') ? undefined : headerValue(request.headers, name);
  }
}

function sfString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function serializeParams(params: SignatureParams): string {
  const list = params.components.map((c) => `"${c}"`).join(' ');
  return `(${list});created=${params.created};expires=${params.expires};keyid=${sfString(params.keyid)};nonce=${sfString(params.nonce)};tag=${sfString(params.tag)}`;
}

/** Build the RFC 9421 signature base for the given components and serialized params. */
export function signatureBase(
  request: SignableRequest,
  components: string[],
  serializedParams: string,
): { base: string; missing: string[] } {
  const lines: string[] = [];
  const missing: string[] = [];
  for (const component of components) {
    const value = componentValue(request, component);
    if (value === undefined) {
      missing.push(component);
      continue;
    }
    lines.push(`"${component}": ${value}`);
  }
  lines.push(`"@signature-params": ${serializedParams}`);
  return { base: lines.join('\n'), missing };
}

/** Sign a request; returns the headers the caller must attach. */
export function signRequest(request: SignableRequest, options: SignOptions): SignedHeaders {
  const components = options.components ?? [...REQUIRED_COMPONENTS];
  const headers: Record<string, string> = {
    ...request.headers,
    'content-digest': contentDigest(request.body),
    'signature-agent': sfString(options.signatureAgent),
    'ucp-agent': options.ucpAgent,
  };
  const params: SignatureParams = {
    components,
    created: Math.floor(options.created.getTime() / 1000),
    expires: Math.floor(options.expires.getTime() / 1000),
    keyid: options.keyid,
    nonce: options.nonce,
    tag: options.tag,
  };
  const serialized = serializeParams(params);
  const { base, missing } = signatureBase({ ...request, headers }, components, serialized);
  if (missing.length > 0) throw new Error(`cannot sign: missing components ${missing.join(', ')}`);
  const privateKey = createPrivateKey({
    key: options.privateJwk as unknown as Record<string, string>,
    format: 'jwk',
  });
  const signature = sign(null, Buffer.from(base, 'utf8'), privateKey).toString('base64');
  return {
    'content-digest': headers['content-digest']!,
    'signature-agent': headers['signature-agent']!,
    'ucp-agent': headers['ucp-agent']!,
    'signature-input': `${SIGNATURE_LABEL}=${serialized}`,
    signature: `${SIGNATURE_LABEL}=:${signature}:`,
  };
}

export type SignatureFailure =
  | 'missing_signature'
  | 'malformed'
  | 'missing_param'
  | 'missing_component'
  | 'tag_mismatch'
  | 'unknown_key'
  | 'digest_mismatch'
  | 'signature'
  | 'not_yet_valid'
  | 'expired'
  | 'lifetime';

export type VerifyResult =
  | { ok: true; params: SignatureParams; serializedParams: string; signatureAgent: string }
  | { ok: false; reason: SignatureFailure; detail?: string };

export interface VerifyOptions {
  resolvePublicJwk: (keyid: string) => Promise<Ed25519PublicJwk | undefined>;
  now: Date;
  requiredTag?: string;
  requiredComponents?: readonly string[];
  maxLifetimeSec?: number;
  clockSkewSec?: number;
}

/** Parse `label=(...);k=v;...` for one label. */
export function parseSignatureInput(
  value: string,
): { label: string; params: SignatureParams; serialized: string } | undefined {
  const eq = value.indexOf('=');
  if (eq <= 0) return undefined;
  const label = value.slice(0, eq).trim();
  const serialized = value.slice(eq + 1).trim();
  const listMatch = /^\(([^)]*)\)(.*)$/s.exec(serialized);
  if (!listMatch) return undefined;
  const components = (listMatch[1] ?? '')
    .trim()
    .split(/\s+/)
    .filter((c) => c.length > 0)
    .map((c) => (c.startsWith('"') && c.endsWith('"') ? c.slice(1, -1) : undefined));
  if (components.some((c) => c === undefined)) return undefined;
  const params: Partial<SignatureParams> = { components: components as string[] };
  const rest = listMatch[2] ?? '';
  const paramPattern = /;([a-z]+)=("(?:[^"\\]|\\.)*"|-?\d+)/g;
  let consumed = 0;
  for (const match of rest.matchAll(paramPattern)) {
    consumed += match[0].length;
    const [, key, raw] = match;
    if (!key || raw === undefined) return undefined;
    const parsed = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : Number(raw);
    switch (key) {
      case 'created':
      case 'expires':
        if (typeof parsed !== 'number' || !Number.isInteger(parsed)) return undefined;
        params[key] = parsed;
        break;
      case 'keyid':
      case 'nonce':
      case 'tag':
        if (typeof parsed !== 'string') return undefined;
        params[key] = parsed;
        break;
      default:
        return undefined;
    }
  }
  if (consumed !== rest.length) return undefined;
  return { label, params: params as SignatureParams, serialized };
}

function parseSignature(value: string, label: string): Buffer | undefined {
  const match = new RegExp(`(?:^|,\\s*)${label}=:([A-Za-z0-9+/=]+):`).exec(value);
  return match?.[1] ? Buffer.from(match[1], 'base64') : undefined;
}

function parseDigest(value: string): Buffer | undefined {
  const match = /sha-256=:([A-Za-z0-9+/=]+):/.exec(value);
  return match?.[1] ? Buffer.from(match[1], 'base64') : undefined;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replace(/\\(.)/g, '$1')
    : value;
}

/** Verify a signed request against policy (components, params, lifetime, digest, key). */
export async function verifyRequestSignature(
  request: SignableRequest,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const signatureInput = headerValue(request.headers, 'signature-input');
  const signatureHeader = headerValue(request.headers, 'signature');
  if (!signatureInput || !signatureHeader) return { ok: false, reason: 'missing_signature' };

  const parsed = parseSignatureInput(signatureInput);
  if (!parsed) return { ok: false, reason: 'malformed', detail: 'Signature-Input' };
  const signature = parseSignature(signatureHeader, parsed.label);
  if (!signature) return { ok: false, reason: 'malformed', detail: 'Signature' };
  const { params } = parsed;

  for (const key of ['created', 'expires', 'keyid', 'nonce', 'tag'] as const) {
    if (params[key] === undefined || params[key] === '')
      return { ok: false, reason: 'missing_param', detail: key };
  }
  const required = options.requiredComponents ?? REQUIRED_COMPONENTS;
  const missingComponents = required.filter((c) => !params.components.includes(c));
  if (missingComponents.length > 0)
    return { ok: false, reason: 'missing_component', detail: missingComponents.join(', ') };
  if (options.requiredTag && params.tag !== options.requiredTag)
    return { ok: false, reason: 'tag_mismatch', detail: params.tag };

  const nowSec = Math.floor(options.now.getTime() / 1000);
  const skew = options.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;
  const maxLifetime = options.maxLifetimeSec ?? DEFAULT_MAX_LIFETIME_SEC;
  if (params.expires <= params.created || params.expires - params.created > maxLifetime)
    return { ok: false, reason: 'lifetime' };
  if (nowSec + skew < params.created) return { ok: false, reason: 'not_yet_valid' };
  if (nowSec - skew > params.expires) return { ok: false, reason: 'expired' };

  const digestHeader = headerValue(request.headers, 'content-digest');
  const expectedDigest = createHash('sha256').update(request.body).digest();
  const receivedDigest = digestHeader ? parseDigest(digestHeader) : undefined;
  if (
    !receivedDigest ||
    receivedDigest.length !== expectedDigest.length ||
    !timingSafeEqual(receivedDigest, expectedDigest)
  ) {
    return { ok: false, reason: 'digest_mismatch' };
  }

  const jwk = await options.resolvePublicJwk(params.keyid);
  if (!jwk) return { ok: false, reason: 'unknown_key', detail: params.keyid };

  const { base, missing } = signatureBase(request, params.components, parsed.serialized);
  if (missing.length > 0)
    return { ok: false, reason: 'missing_component', detail: missing.join(', ') };
  let valid: boolean;
  try {
    const publicKey = createPublicKey({
      key: jwk as unknown as Record<string, string>,
      format: 'jwk',
    });
    valid = verify(null, Buffer.from(base, 'utf8'), publicKey, signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'signature' };

  const signatureAgent = headerValue(request.headers, 'signature-agent');
  return {
    ok: true,
    params,
    serializedParams: parsed.serialized,
    signatureAgent: signatureAgent ? unquote(signatureAgent) : '',
  };
}
