import { randomUUID } from 'node:crypto';
import { signRequest, type KeyPair } from '@authera/domain';
import type { Clock } from '../clock.js';
import { signClosedCheckout, type ClosedCheckoutPayload } from './closed-checkout.js';

export interface AgentClientOptions {
  keyPair: KeyPair;
  /** Agent profile URI advertised in Signature-Agent / UCP-Agent. */
  profileUri: string;
  baseUrl: string;
  clock: Clock;
  /** Transport; defaults to global fetch. In-process demos pass `app.fetch`. */
  fetch?: (request: Request) => Promise<Response>;
}

/**
 * The purchasing agent's HTTP client (spec Phase 4/7): every call is a real RFC 9421-signed
 * request through the same middleware as external agents. Demo controls reuse it, so demo
 * traffic can never bypass verification.
 */
export class AgentHttpClient {
  private readonly send: (request: Request) => Promise<Response>;

  constructor(private readonly options: AgentClientOptions) {
    this.send = options.fetch ?? ((request) => fetch(request));
  }

  build(input: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
    tag: string;
    nonce?: string;
    keyPair?: KeyPair;
    created?: Date;
    expires?: Date;
    signal?: AbortSignal;
  }): Request {
    const now = input.created ?? this.options.clock.now();
    const keyPair = input.keyPair ?? this.options.keyPair;
    const bodyText = input.body === undefined ? '' : JSON.stringify(input.body);
    const bodyBytes = new TextEncoder().encode(bodyText);
    const url = new URL(input.path, this.options.baseUrl).toString();
    const headers: Record<string, string> =
      input.body === undefined ? {} : { 'content-type': 'application/json' };
    const signed = signRequest(
      { method: input.method, url, headers, body: bodyBytes },
      {
        privateJwk: keyPair.privateJwk,
        keyid: keyPair.thumbprint,
        tag: input.tag,
        nonce: input.nonce ?? randomUUID(),
        created: now,
        expires: input.expires ?? new Date(now.getTime() + 120_000),
        signatureAgent: this.options.profileUri,
        ucpAgent: `profile="${this.options.profileUri}"`,
      },
    );
    return new Request(url, {
      method: input.method,
      headers: { ...headers, ...signed },
      signal: input.signal,
      ...(input.body === undefined ? {} : { body: bodyText }),
    });
  }

  async call<T>(
    input: Parameters<AgentHttpClient['build']>[0],
  ): Promise<{ status: number; body: T; request: Request }> {
    const request = this.build(input);
    const response = await this.send(request.clone());
    const body = (await response.json()) as T;
    return { status: response.status, body, request };
  }

  /** The agent's closed Checkout Mandate for one exact transaction, signed with its key. */
  signClosedCheckout(binding: ClosedCheckoutPayload, keyPair?: KeyPair): Promise<string> {
    const pair = keyPair ?? this.options.keyPair;
    return signClosedCheckout(
      { privateJwk: pair.privateJwk, thumbprint: pair.thumbprint },
      binding,
      this.options.clock.now(),
    );
  }

  /** Re-send a previously built request byte-for-byte (replay demo). */
  async replay<T>(request: Request): Promise<{ status: number; body: T }> {
    const response = await this.send(request.clone());
    return { status: response.status, body: (await response.json()) as T };
  }
}
