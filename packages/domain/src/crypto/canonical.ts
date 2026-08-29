import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';

/**
 * RFC 8785 JSON Canonicalization Scheme. Key order, whitespace, and number formatting are
 * normalized so equal values always hash equally.
 */
export function canonicalJson(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) throw new TypeError('value is not JSON-serializable');
  return result;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256Base64(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('base64');
}

export const HASH_PREFIX = 'sha256:';

/** `sha256:<hex>` of the canonical JSON form. Used for carts, policies, and audit events. */
export function hashCanonical(value: unknown): string {
  return `${HASH_PREFIX}${sha256Hex(canonicalJson(value))}`;
}

/** Content-Digest header value (RFC 9530) for a raw request body. */
export function contentDigestHeader(body: Uint8Array): string {
  return `sha-256=:${sha256Base64(body)}:`;
}
