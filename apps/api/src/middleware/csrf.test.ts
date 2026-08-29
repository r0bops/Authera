import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../http/envelope.js';
import { ApiProblem } from '../http/problem.js';
import { csrfGuard } from './csrf.js';

function build() {
  const app = new Hono<AppEnv>();
  app.onError((error, c) =>
    error instanceof ApiProblem
      ? c.json({ code: error.code }, error.status)
      : c.json({ code: 'X' }, 500),
  );
  app.use('*', csrfGuard({ publicBaseUrl: 'https://agentcerta.example' }));
  app.post('/api/x', (c) => c.json({ ok: true }));
  app.get('/api/x', (c) => c.json({ ok: true }));
  return app;
}

describe('csrfGuard', () => {
  it('lets safe methods through untouched', async () => {
    expect((await build().request('/api/x')).status).toBe(200);
  });

  it('requires the custom header on mutations', async () => {
    expect((await build().request('/api/x', { method: 'POST' })).status).toBe(403);
    expect(
      (
        await build().request('/api/x', {
          method: 'POST',
          headers: { 'X-Requested-With': 'AgentCerta' },
        })
      ).status,
    ).toBe(200);
  });

  it('accepts same-origin browsers and rejects cross-site ones', async () => {
    const headers = { 'X-Requested-With': 'AgentCerta' };
    expect(
      (
        await build().request('/api/x', {
          method: 'POST',
          headers: {
            ...headers,
            origin: 'https://agentcerta.example',
            'sec-fetch-site': 'same-origin',
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await build().request('http://localhost:5173/api/x', {
          method: 'POST',
          headers: { ...headers, origin: 'http://localhost:5173', host: 'localhost:5173' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await build().request('/api/x', {
          method: 'POST',
          headers: { ...headers, origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await build().request('/api/x', {
          method: 'POST',
          headers: { ...headers, 'sec-fetch-site': 'cross-site' },
        })
      ).status,
    ).toBe(403);
  });
});
