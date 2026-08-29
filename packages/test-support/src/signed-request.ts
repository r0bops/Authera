import { randomUUID } from 'node:crypto';
import { signRequest, type KeyPair } from '@agentcerta/domain';

export interface SignedRequestOptions {
  keyPair: KeyPair;
  method: 'GET' | 'POST';
  url: string;
  body?: unknown;
  tag: string;
  signatureAgent: string;
  created?: Date;
  expires?: Date;
  nonce?: string;
  /** Override the keyid advertised in the signature (to test unknown keys). */
  keyid?: string;
  extraHeaders?: Record<string, string>;
}

/**
 * Build a signed `Request` for tests and the scripted demo agent. The body is serialized once and
 * the same bytes are digested, signed, and sent.
 */
export function signedRequest(options: SignedRequestOptions): Request {
  const created = options.created ?? new Date();
  const expires = options.expires ?? new Date(created.getTime() + 120_000);
  const bodyText = options.body === undefined ? '' : JSON.stringify(options.body);
  const bodyBytes = new TextEncoder().encode(bodyText);
  const headers: Record<string, string> = {
    ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(options.extraHeaders ?? {}),
  };
  const signed = signRequest(
    { method: options.method, url: options.url, headers, body: bodyBytes },
    {
      privateJwk: options.keyPair.privateJwk,
      keyid: options.keyid ?? options.keyPair.thumbprint,
      tag: options.tag,
      nonce: options.nonce ?? randomUUID(),
      created,
      expires,
      signatureAgent: options.signatureAgent,
      ucpAgent: `profile="${options.signatureAgent}"`,
    },
  );
  return new Request(options.url, {
    method: options.method,
    headers: { ...headers, ...signed },
    ...(options.body === undefined ? {} : { body: bodyText }),
  });
}
