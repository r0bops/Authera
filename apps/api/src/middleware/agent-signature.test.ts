import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppendAuditEventInput } from '@authera/db';
import { loadKeyMaterial } from '@authera/domain';
import { signedRequest } from '@authera/test-support';
import { fixedClock } from '../clock.js';
import { fail, ok, type AppEnv } from '../http/envelope.js';
import { ApiProblem } from '../http/problem.js';
import type { AgentIdentityStore, ResolvedAgentKey } from '../services/agent-identity.js';
import { AGENT_TAGS, agentSignature } from './agent-signature.js';

const keys = loadKeyMaterial({ demoSecret: 'middleware-test' });
const other = loadKeyMaterial({ demoSecret: 'middleware-other' });
const NOW = new Date('2026-08-30T12:00:00.000Z');
const PROFILE = 'http://localhost:3000/agents/22222222-2222-4222-8222-222222222222/profile';
const URL_ = 'http://localhost:3000/api/agent/ping';

function memoryStore(overrides: Partial<ResolvedAgentKey> = {}) {
  const nonces = new Set<string>();
  const events: AppendAuditEventInput[] = [];
  const key: ResolvedAgentKey = {
    agentId: '22222222-2222-4222-8222-222222222222',
    agentKeyId: 'key-1',
    thumbprint: keys.agent.thumbprint,
    publicJwk: keys.agent.publicJwk,
    keyStatus: 'ACTIVE',
    agentStatus: 'ACTIVE',
    profileUri: PROFILE,
    displayName: 'Aria',
    ...overrides,
  };
  const store: AgentIdentityStore = {
    findKey: async (thumbprint) => (thumbprint === key.thumbprint ? key : undefined),
    claimNonce: async ({ agentKeyId, nonce }) => {
      const id = `${agentKeyId}:${nonce}`;
      if (nonces.has(id)) return false;
      nonces.add(id);
      return true;
    },
    audit: async (event) => {
      events.push(event);
    },
  };
  return { store, events };
}

function build(
  store: AgentIdentityStore,
  tag: (typeof AGENT_TAGS)[keyof typeof AGENT_TAGS] = AGENT_TAGS.browse,
) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'test');
    await next();
  });
  app.onError((error, c) =>
    error instanceof ApiProblem
      ? fail(c, error.status, error.code, error.message)
      : fail(c, 500, 'X', 'boom'),
  );
  app.use('/api/agent/*', agentSignature({ store, clock: fixedClock(NOW), tag }));
  app.post('/api/agent/ping', (c) =>
    ok(c, { agentId: c.get('agentRequest')!.agent.agentId, nonce: c.get('agentRequest')!.nonce }),
  );
  return app;
}

const sign = (opts: Partial<Parameters<typeof signedRequest>[0]> = {}) =>
  signedRequest({
    keyPair: keys.agent,
    method: 'POST',
    url: URL_,
    body: { hello: 'world' },
    tag: AGENT_TAGS.browse,
    signatureAgent: PROFILE,
    created: NOW,
    ...opts,
  });

async function code(res: Response) {
  const body = (await res.json()) as { ok: boolean; error?: { code: string } };
  return body.ok ? 'OK' : body.error?.code;
}

describe('agentSignature middleware', () => {
  it('lets a valid signed request reach the protected route and audits the verification', async () => {
    const { store, events } = memoryStore();
    const res = await build(store).request(sign({ nonce: 'n1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      data: { agentId: '22222222-2222-4222-8222-222222222222', nonce: 'n1' },
    });
    expect(events.map((e) => e.eventType)).toEqual(['AGENT_SIGNATURE_VERIFIED']);
  });

  it('rejects a replayed request with REPLAY_DETECTED', async () => {
    const { store, events } = memoryStore();
    const app = build(store);
    const request = sign({ nonce: 'replay-me' });
    expect((await app.request(request.clone())).status).toBe(200);
    const replay = await app.request(request.clone());
    expect(replay.status).toBe(409);
    expect(await code(replay)).toBe('REPLAY_DETECTED');
    expect(events.map((e) => e.eventType)).toEqual(['AGENT_SIGNATURE_VERIFIED', 'REPLAY_REJECTED']);
  });

  it('rejects the wrong key, an unknown key, an altered body, and an expired signature', async () => {
    const { store, events } = memoryStore();
    const app = build(store);
    expect(
      await code(await app.request(sign({ keyPair: other.agent, keyid: keys.agent.thumbprint }))),
    ).toBe('SIGNATURE_INVALID');
    expect(await code(await app.request(sign({ keyPair: other.agent })))).toBe('AGENT_UNKNOWN');
    const altered = sign();
    const tampered = new Request(altered, { body: '{"hello":"evil"}' });
    expect(await code(await app.request(tampered))).toBe('SIGNATURE_INVALID');
    expect(
      await code(
        await app.request(
          sign({
            created: new Date(NOW.getTime() - 900_000),
            expires: new Date(NOW.getTime() - 600_000),
          }),
        ),
      ),
    ).toBe('REQUEST_EXPIRED');
    expect(events.every((e) => e.eventType === 'AGENT_SIGNATURE_REJECTED')).toBe(true);
    expect(events).toHaveLength(4);
  });

  it('rejects a missing component, a wrong purpose tag, and a mismatched Signature-Agent', async () => {
    const { store } = memoryStore();
    const app = build(store, AGENT_TAGS.payment);
    expect(await code(await app.request(sign({ tag: AGENT_TAGS.browse })))).toBe(
      'SIGNATURE_INVALID',
    );
    expect(
      await code(
        await app.request(
          sign({ tag: AGENT_TAGS.payment, signatureAgent: 'https://evil.example/profile' }),
        ),
      ),
    ).toBe('SIGNATURE_INVALID');
    const unsigned = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(await code(await app.request(unsigned))).toBe('SIGNATURE_INVALID');
  });

  it('rejects a valid signature from a revoked agent or key', async () => {
    const revokedAgent = memoryStore({ agentStatus: 'REVOKED' });
    const res = await build(revokedAgent.store).request(sign());
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('AGENT_REVOKED');
    const revokedKey = memoryStore({ keyStatus: 'REVOKED' });
    expect(await code(await build(revokedKey.store).request(sign()))).toBe('AGENT_REVOKED');
  });

  it('refuses non-JSON and oversized bodies before touching crypto', async () => {
    const { store, events } = memoryStore();
    const app = build(store);
    const form = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'x',
    });
    expect((await app.request(form)).status).toBe(415);
    const big = sign({ body: { blob: 'x'.repeat(70_000) } });
    expect((await app.request(big)).status).toBe(413);
    expect(events).toHaveLength(0);
  });
});
