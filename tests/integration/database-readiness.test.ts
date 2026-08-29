import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@authera/api/app';
import { loadConfig } from '@authera/api/config';
import { createLogger } from '@authera/api/logger';
import { checkDatabaseReady, createPool, type DatabasePool } from '@authera/db';
import { testEnv } from '@authera/test-support';

const POSTGRES_IMAGE = 'postgres:18-alpine';
const logger = createLogger({ level: 'silent' });

describe('database readiness against real PostgreSQL', () => {
  let container: StartedPostgreSqlContainer;
  let pool: DatabasePool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    pool = createPool(container.getConnectionUri());
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('reports ready and /health/ready answers 200', async () => {
    const check = await checkDatabaseReady(pool);
    expect(check).toMatchObject({ ok: true });

    const app = createApp({
      config: loadConfig(testEnv({ DATABASE_URL: container.getConnectionUri() })),
      logger,
      checkDatabase: () => checkDatabaseReady(pool),
    });
    const res = await app.request('/health/ready');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      data: { status: 'ready', checks: { database: { ok: true } } },
    });
  });

  it('reports not ready and /health/ready answers 503 when nothing listens', async () => {
    const deadPool = createPool('postgres://authera:authera@127.0.0.1:1/authera', {
      connectionTimeoutMillis: 1_000,
    });
    try {
      const startedAt = Date.now();
      const check = await checkDatabaseReady(deadPool, { timeoutMs: 3_000 });
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(check.ok).toBe(false);

      const app = createApp({
        config: loadConfig(testEnv()),
        logger,
        checkDatabase: () => checkDatabaseReady(deadPool, { timeoutMs: 3_000 }),
      });
      const res = await app.request('/health/ready');
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    } finally {
      await deadPool.end();
    }
  });

  it('does not leak credentials when authentication fails', async () => {
    const password = 'definitely-wrong-password';
    const badAuthPool = createPool(
      `postgres://${container.getUsername()}:${password}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
    );
    try {
      const check = await checkDatabaseReady(badAuthPool);
      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(check.error).not.toContain(password);
      }
    } finally {
      await badAuthPool.end();
    }
  });
});
