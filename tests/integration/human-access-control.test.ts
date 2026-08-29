import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@authera/api/app';
import { loadConfig } from '@authera/api/config';
import { createLogger } from '@authera/api/logger';
import { createExecution, createMandate, schema, SEED_IDS, type ExecutionRow } from '@authera/db';
import { hashCanonical } from '@authera/domain';
import { mandatePolicyFixture, testEnv } from '@authera/test-support';
import type { Clock } from '../../apps/api/src/clock.js';
import { MockPaymentProcessor } from '../../apps/api/src/services/payments/mock-processor.js';
import { startTestPostgres, type TestPostgres } from './helpers/postgres.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const OTHER_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789';

describe('human data access control', () => {
  let pg: TestPostgres;
  let app: ReturnType<typeof createApp>;
  let victimExecution: ExecutionRow;
  let ownerCookie: string;
  let otherCookie: string;

  beforeAll(async () => {
    pg = await startTestPostgres();
    const clock: Clock = {
      now: () => new Date(NOW),
      offsetMs: () => 0,
      setOffset: () => undefined,
    };
    const policy = mandatePolicyFixture({
      mandateId: randomUUID(),
      humanId: SEED_IDS.marta,
      agentId: SEED_IDS.agent,
      agentKeyThumbprint: pg.keys.agent.thumbprint,
      allowedMerchantIds: [SEED_IDS.vuelaya],
      paymentMethodRef: SEED_IDS.paymentMethod,
    });
    await createMandate(pg.db, {
      policy,
      policyHash: hashCanonical(policy),
      jws: 'jws.fixture',
      signingKid: pg.keys.trustedSurface.kid,
      actorId: SEED_IDS.marta,
    });
    ({ execution: victimExecution } = await createExecution(pg.db, {
      id: randomUUID(),
      evidenceId: `ev-${randomUUID()}`,
      mandateId: policy.mandateId,
      mandateVersion: policy.version,
      agentId: SEED_IDS.agent,
      agentKeyId: SEED_IDS.agentKey,
    }));

    await pg.db.insert(schema.users).values({
      id: OTHER_USER_ID,
      email: 'other@example.com',
      displayName: 'Other User',
    });
    ownerCookie = await createSession(SEED_IDS.marta);
    otherCookie = await createSession(OTHER_USER_ID);

    const config = loadConfig(
      testEnv({
        DATABASE_URL: pg.container.getConnectionUri(),
        DEMO_MODE: 'false',
        DEMO_RESET_SECRET: undefined,
      }),
    );
    app = createApp({
      config,
      logger: createLogger({ level: 'silent' }),
      checkDatabase: async () => ({ ok: true, latencyMs: 0 }),
      services: {
        db: pg.db,
        keys: pg.keys,
        clock,
        paymentProcessor: new MockPaymentProcessor(clock),
        seed: pg.seed,
      },
    });

    async function createSession(userId: string): Promise<string> {
      const token = randomUUID();
      await pg.db.insert(schema.humanSessions).values({
        id: randomUUID(),
        userId,
        tokenHash: createHmac('sha256', SESSION_SECRET).update(token).digest('hex'),
        expiresAt: new Date(NOW.getTime() + 60_000),
      });
      return `authera_session=${token}`;
    }
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('allows the owner to read their execution', async () => {
    const response = await app.request(`/api/executions/${victimExecution.id}`, {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(200);
  });

  it('does not expose another user’s records through lists or direct identifiers', async () => {
    const executions = await app.request('/api/executions', {
      headers: { cookie: otherCookie },
    });
    expect(executions.status).toBe(200);
    expect(await executions.json()).toMatchObject({ ok: true, data: [] });

    const audit = await app.request('/api/audit/events', {
      headers: { cookie: otherCookie },
    });
    expect(audit.status).toBe(200);
    expect(await audit.json()).toMatchObject({ ok: true, data: [] });

    for (const path of [
      `/api/executions/${victimExecution.id}`,
      `/api/purchases/${victimExecution.id}`,
      `/api/verification/${victimExecution.id}`,
      `/api/evidence/${victimExecution.id}`,
      `/api/evidence/${victimExecution.id}/export`,
      `/api/evidence/${victimExecution.id}/ap2`,
    ]) {
      const response = await app.request(path, { headers: { cookie: otherCookie } });
      expect(response.status, path).toBe(404);
    }
  });

  it('does not allow another user to open a dispute for the execution', async () => {
    const response = await app.request('/api/disputes', {
      method: 'POST',
      headers: {
        cookie: otherCookie,
        'content-type': 'application/json',
        'x-requested-with': 'Authera',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        executionId: victimExecution.id,
        reason: 'UNRECOGNIZED_AGENT',
      }),
    });
    expect(response.status).toBe(404);
  });
});
