import { describe, expect, it } from 'vitest';
import { loadKeyMaterial } from './keys.js';
import {
  contentDigest,
  parseSignatureInput,
  REQUIRED_COMPONENTS,
  serializeParams,
  signRequest,
  verifyRequestSignature,
  type SignableRequest,
} from './http-signatures.js';

const keys = loadKeyMaterial({ demoSecret: 'http-sig-test' });
const other = loadKeyMaterial({ demoSecret: 'http-sig-other' });
const NOW = new Date('2026-08-30T12:00:00.000Z');
const PROFILE = 'http://localhost:3000/agents/22222222-2222-4222-8222-222222222222/profile';

function baseRequest(body = '{"executionId":"x"}'): SignableRequest {
  return {
    method: 'POST',
    url: 'http://localhost:3000/api/purchase-attempts',
    headers: { 'content-type': 'application/json' },
    body: new TextEncoder().encode(body),
  };
}

function signed(
  overrides: Partial<Parameters<typeof signRequest>[1]> = {},
  request = baseRequest(),
) {
  const headers = signRequest(request, {
    privateJwk: keys.agent.privateJwk,
    keyid: keys.agent.thumbprint,
    tag: 'agentcerta:payment',
    nonce: 'nonce-1',
    created: NOW,
    expires: new Date(NOW.getTime() + 120_000),
    signatureAgent: PROFILE,
    ucpAgent: `profile="${PROFILE}"`,
    ...overrides,
  });
  return { ...request, headers: { ...request.headers, ...headers } };
}

const resolve = (keyid: string) =>
  Promise.resolve(keyid === keys.agent.thumbprint ? keys.agent.publicJwk : undefined);
const verify = (
  req: SignableRequest,
  opts: Partial<Parameters<typeof verifyRequestSignature>[1]> = {},
) =>
  verifyRequestSignature(req, {
    resolvePublicJwk: resolve,
    now: NOW,
    requiredTag: 'agentcerta:payment',
    ...opts,
  });

describe('RFC 9421 request signatures', () => {
  it('signs and verifies with all required components and params', async () => {
    const req = signed();
    expect(req.headers['content-digest']).toBe(contentDigest(req.body));
    const result = await verify(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.components).toEqual([...REQUIRED_COMPONENTS]);
      expect(result.params.nonce).toBe('nonce-1');
      expect(result.signatureAgent).toBe(PROFILE);
    }
  });

  it('round-trips the serialized params through the parser', () => {
    const params = {
      components: [...REQUIRED_COMPONENTS],
      created: 1,
      expires: 2,
      keyid: 'k"1',
      nonce: 'n',
      tag: 't',
    };
    const parsed = parseSignatureInput(`sig1=${serializeParams(params)}`);
    expect(parsed?.params).toEqual(params);
    expect(parseSignatureInput('garbage')).toBeUndefined();
    expect(parseSignatureInput('sig1=("@method");created=abc')).toBeUndefined();
  });

  it('rejects a wrong key, a modified body, a modified path, and a modified header', async () => {
    const wrongKey = signed({ privateJwk: other.agent.privateJwk });
    expect(await verify(wrongKey)).toEqual({ ok: false, reason: 'signature' });

    const modifiedBody = { ...signed(), body: new TextEncoder().encode('{"executionId":"y"}') };
    expect(await verify(modifiedBody)).toEqual({ ok: false, reason: 'digest_mismatch' });

    const movedPath = { ...signed(), url: 'http://localhost:3000/api/other' };
    expect(await verify(movedPath)).toEqual({ ok: false, reason: 'signature' });

    const req = signed();
    req.headers['ucp-agent'] = 'profile="https://evil.example/profile"';
    expect(await verify(req)).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects missing signature, unknown key, missing components, and wrong tag', async () => {
    expect(await verify(baseRequest())).toEqual({ ok: false, reason: 'missing_signature' });
    expect(await verify(signed({ keyid: 'unknown' }))).toMatchObject({
      ok: false,
      reason: 'unknown_key',
    });
    expect(
      await verify(signed({ components: ['@method', '@authority', '@path', 'content-digest'] })),
    ).toMatchObject({ ok: false, reason: 'missing_component' });
    expect(await verify(signed({ tag: 'agentcerta:browse' }))).toMatchObject({
      ok: false,
      reason: 'tag_mismatch',
    });
  });

  it('enforces created/expires lifetime and skew', async () => {
    const expired = signed({
      created: new Date(NOW.getTime() - 600_000),
      expires: new Date(NOW.getTime() - 300_000),
    });
    expect(await verify(expired)).toEqual({ ok: false, reason: 'expired' });
    const future = signed({
      created: new Date(NOW.getTime() + 600_000),
      expires: new Date(NOW.getTime() + 700_000),
    });
    expect(await verify(future)).toEqual({ ok: false, reason: 'not_yet_valid' });
    const tooLong = signed({ expires: new Date(NOW.getTime() + 3_600_000) });
    expect(await verify(tooLong)).toEqual({ ok: false, reason: 'lifetime' });
    const withinSkew = signed({
      created: new Date(NOW.getTime() + 10_000),
      expires: new Date(NOW.getTime() + 100_000),
    });
    expect((await verify(withinSkew)).ok).toBe(true);
  });

  it('signs an empty body (GET) with a valid digest', async () => {
    const req = signed(
      { tag: 'agentcerta:browse' },
      {
        method: 'GET',
        url: 'http://localhost:3000/api/flights?origin=CCS',
        headers: {},
        body: new Uint8Array(),
      },
    );
    expect((await verify(req, { requiredTag: 'agentcerta:browse' })).ok).toBe(true);
  });
});
