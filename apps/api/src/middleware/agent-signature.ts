import type { MiddlewareHandler } from 'hono';
import type { ReasonCode } from '@authera/contracts';
import { contentDigest, verifyRequestSignature, type SignatureFailure } from '@authera/domain';
import type { Clock } from '../clock.js';
import type { AppEnv } from '../http/envelope.js';
import { ApiProblem } from '../http/problem.js';
import type { AgentIdentityStore, ResolvedAgentKey } from '../services/agent-identity.js';

export const AGENT_TAGS = { browse: 'authera:browse', payment: 'authera:payment' } as const;
const MAX_BODY_BYTES = 64 * 1024;
const NONCE_TTL_MS = 10 * 60 * 1000;

export interface VerifiedAgentRequest {
  agent: ResolvedAgentKey;
  nonce: string;
  requestDigest: string;
  rawBody: Uint8Array;
  tag: string;
  created: number;
  expires: number;
}

export interface AgentSignatureDependencies {
  store: AgentIdentityStore;
  clock: Clock;
  tag: (typeof AGENT_TAGS)[keyof typeof AGENT_TAGS];
}

function reasonFor(failure: SignatureFailure): ReasonCode {
  switch (failure) {
    case 'unknown_key':
      return 'AGENT_UNKNOWN';
    case 'expired':
    case 'not_yet_valid':
    case 'lifetime':
      return 'REQUEST_EXPIRED';
    default:
      return 'SIGNATURE_INVALID';
  }
}

/**
 * Agent request verification in the order the spec fixes (§11): method/content-type/size,
 * raw bytes + Content-Digest, Signature-Agent profile, pinned key, required components and
 * params, short lifetime with bounded skew, unique nonce, active key and agent. A valid
 * signature only earns access to the agent lane — never authorization to spend.
 */
export function agentSignature(deps: AgentSignatureDependencies): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method !== 'GET' && method !== 'POST')
      throw new ApiProblem(405, 'METHOD_NOT_ALLOWED', 'Unsupported method');
    const contentType = c.req.header('content-type') ?? '';
    if (method === 'POST' && !contentType.toLowerCase().startsWith('application/json')) {
      throw new ApiProblem(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Agent requests must be application/json',
      );
    }
    const declaredLength = Number(c.req.header('content-length') ?? '0');
    if (declaredLength > MAX_BODY_BYTES)
      throw new ApiProblem(413, 'PAYLOAD_TOO_LARGE', 'Agent request body too large');
    const rawBody = new Uint8Array(await c.req.arrayBuffer());
    if (rawBody.byteLength > MAX_BODY_BYTES)
      throw new ApiProblem(413, 'PAYLOAD_TOO_LARGE', 'Agent request body too large');

    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const requestDigest = contentDigest(rawBody);
    const now = deps.clock.now();
    let resolved: ResolvedAgentKey | undefined;

    const reject = async (
      reasonCode: ReasonCode,
      detail: string,
      keyid?: string,
      status: 401 | 403 = 401,
    ) => {
      await deps.store.audit({
        eventType: 'AGENT_SIGNATURE_REJECTED',
        actorType: 'AGENT',
        actorId: keyid ?? null,
        reasonCode,
        detail,
        payload: { method, path: c.req.path, requestDigest, tag: deps.tag },
      });
      throw new ApiProblem(status, reasonCode, detail);
    };

    const result = await verifyRequestSignature(
      { method, url: c.req.url, headers, body: rawBody },
      {
        now,
        requiredTag: deps.tag,
        resolvePublicJwk: async (keyid) => {
          resolved = await deps.store.findKey(keyid);
          return resolved?.publicJwk;
        },
      },
    );
    if (!result.ok) {
      const detail = `${result.reason}${result.detail ? `: ${result.detail}` : ''}`;
      const keyid = /keyid="([^"]+)"/.exec(headers['signature-input'] ?? '')?.[1];
      await reject(reasonFor(result.reason), `Signature rejected (${detail})`, keyid);
    }
    const verified = result as Extract<typeof result, { ok: true }>;
    const agent = resolved!;

    if (verified.signatureAgent !== agent.profileUri) {
      await reject(
        'SIGNATURE_INVALID',
        'Signature-Agent does not match the registered agent profile',
        agent.thumbprint,
      );
    }
    if (agent.keyStatus !== 'ACTIVE' || agent.agentStatus !== 'ACTIVE') {
      await reject('AGENT_REVOKED', 'Agent or key is revoked', agent.thumbprint, 403);
    }
    if (agent.validFrom > now || (agent.validUntil && agent.validUntil <= now)) {
      await reject(
        'AGENT_REVOKED',
        'Agent key is outside its validity window',
        agent.thumbprint,
        403,
      );
    }

    const fresh = await deps.store.claimNonce({
      agentKeyId: agent.agentKeyId,
      nonce: verified.params.nonce,
      requestDigest,
      expiresAt: new Date(Math.max(verified.params.expires * 1000, now.getTime()) + NONCE_TTL_MS),
    });
    if (!fresh) {
      await deps.store.audit({
        eventType: 'REPLAY_REJECTED',
        actorType: 'AGENT',
        actorId: agent.thumbprint,
        reasonCode: 'REPLAY_DETECTED',
        detail: `nonce ${verified.params.nonce}`,
        payload: { nonce: verified.params.nonce, requestDigest, path: c.req.path },
      });
      throw new ApiProblem(409, 'REPLAY_DETECTED', 'This signed request was already used');
    }

    await deps.store.audit({
      eventType: 'AGENT_SIGNATURE_VERIFIED',
      actorType: 'AGENT',
      actorId: agent.thumbprint,
      detail: `${method} ${c.req.path}`,
      payload: {
        agentId: agent.agentId,
        keyThumbprint: agent.thumbprint,
        nonce: verified.params.nonce,
        requestDigest,
        tag: verified.params.tag,
        created: verified.params.created,
        expires: verified.params.expires,
      },
    });

    const context: VerifiedAgentRequest = {
      agent,
      nonce: verified.params.nonce,
      requestDigest,
      rawBody,
      tag: verified.params.tag,
      created: verified.params.created,
      expires: verified.params.expires,
    };
    c.set('agentRequest', context);
    await next();
  };
}
