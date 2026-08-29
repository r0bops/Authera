import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '@authera/test-support';
import type { ReadinessCheck } from '@authera/contracts';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

const config = loadConfig(testEnv());
const logger = createLogger({ level: 'silent' });

/** Loose view of the API envelope for assertions (Response.json() is typed unknown). */
interface Envelope {
  ok: boolean;
  requestId: string;
  data?: { status?: string; uptimeSeconds?: number };
  error?: {
    code: string;
    message: string;
    details?: { checks?: { database?: { ok: boolean; error?: string } } };
  };
}
const json = async (res: Response): Promise<Envelope> => (await res.json()) as Envelope;

function build(checkDatabase: () => Promise<ReadinessCheck>, webDistDir?: string) {
  return createApp({ config, logger, checkDatabase, ...(webDistDir ? { webDistDir } : {}) });
}

const healthyProbe = async (): Promise<ReadinessCheck> => ({ ok: true, latencyMs: 3 });
const failingProbe = async (): Promise<ReadinessCheck> => ({
  ok: false,
  error: 'ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:1',
});

describe('GET /health/live', () => {
  it('answers with the success envelope and a request id', async () => {
    const app = build(healthyProbe);
    const res = await app.request('/health/live');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ ok: true, data: { status: 'live' } });
    expect(typeof body.data?.uptimeSeconds).toBe('number');
    expect(typeof body.requestId).toBe('string');
    expect(res.headers.get('x-request-id')).toBe(body.requestId);
  });

  it('echoes a caller-supplied X-Request-Id', async () => {
    const app = build(healthyProbe);
    const res = await app.request('/health/live', { headers: { 'x-request-id': 'judge-run-42' } });
    expect((await json(res)).requestId).toBe('judge-run-42');
  });
});

describe('GET /health/ready', () => {
  it('returns 200 with the database check when the probe succeeds', async () => {
    const app = build(healthyProbe);
    const res = await app.request('/health/ready');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      data: { status: 'ready', checks: { database: { ok: true, latencyMs: 3 } } },
    });
  });

  it('returns 503 NOT_READY with the failing check when the database is unavailable', async () => {
    const app = build(failingProbe);
    const res = await app.request('/health/ready');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_READY',
        details: {
          checks: { database: { ok: false, error: expect.stringContaining('ECONNREFUSED') } },
        },
      },
    });
  });

  it('still answers 503 when the probe itself throws', async () => {
    const app = build(async () => {
      throw new Error('probe exploded');
    });
    const res = await app.request('/health/ready');
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('NOT_READY');
    expect(body.error?.details?.checks?.database?.error).toContain('probe exploded');
  });
});

describe('error envelopes', () => {
  it('returns a JSON 404 envelope for unknown routes', async () => {
    const app = build(healthyProbe);
    for (const path of ['/api/nothing', '/health/nothing', '/definitely-not-here']) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    }
  });

  it('returns a JSON 500 envelope without leaking the stack when a handler throws', async () => {
    const app = build(healthyProbe);
    app.get('/boom', () => {
      throw new Error('kaboom internal detail');
    });
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(body)).not.toContain('kaboom internal detail');
  });

  it('rejects oversized request bodies before routing or parsing them', async () => {
    const app = build(healthyProbe);
    const res = await app.request('/api/nothing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(256 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: { code: 'PAYLOAD_TOO_LARGE' },
    });
  });
});

describe('static SPA serving', () => {
  let distDir: string;

  beforeAll(() => {
    distDir = mkdtempSync(join(tmpdir(), 'authera-web-dist-'));
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log("spa")');
  });

  afterAll(() => {
    rmSync(distDir, { recursive: true, force: true });
  });

  it('serves index.html, hashed assets, and deep links', async () => {
    const app = build(healthyProbe, distDir);

    const index = await app.request('/');
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(await index.text()).toContain('id="root"');

    const asset = await app.request('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(await asset.text()).toBe('console.log("spa")');

    const deepLink = await app.request('/mandates/abc-123');
    expect(deepLink.status).toBe(200);
    expect(await deepLink.text()).toContain('id="root"');
  });

  it('keeps backend namespaces as JSON 404s instead of falling back to the SPA', async () => {
    const app = build(healthyProbe, distDir);
    for (const path of [
      '/api/nothing',
      '/health/nothing',
      '/ucp/x',
      '/.well-known/x',
      '/webhooks/x',
    ]) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    }
  });

  it('does not allow path traversal out of the dist directory', async () => {
    const app = build(healthyProbe, distDir);
    const res = await app.request('/../../etc/passwd');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });
});
