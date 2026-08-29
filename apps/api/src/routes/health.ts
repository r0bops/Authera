import { Hono } from 'hono';
import {
  NOT_READY_ERROR_CODE,
  type HealthLiveData,
  type HealthReadyData,
  type ReadinessCheck,
} from '@agentcerta/contracts';
import { fail, ok, type AppEnv } from '../http/envelope.js';

export interface HealthDependencies {
  /** Real database probe. Must resolve (never reject) with a structured result. */
  checkDatabase: () => Promise<ReadinessCheck>;
}

/**
 * GET /health/live  — the process is running (no dependencies consulted).
 * GET /health/ready — the database answers; 503 with the failing check otherwise.
 * Readiness deliberately ignores OpenAI and Yuno (CLAUDE_IMPLEMENTATION_SPEC.md §17).
 */
export function healthRoutes(deps: HealthDependencies) {
  const routes = new Hono<AppEnv>();

  routes.get('/live', (c) => {
    const data: HealthLiveData = {
      status: 'live',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
    return ok(c, data);
  });

  routes.get('/ready', async (c) => {
    const database = await probe(deps.checkDatabase);
    if (database.ok) {
      const data: HealthReadyData = { status: 'ready', checks: { database } };
      return ok(c, data);
    }
    c.get('logger').warn({ checks: { database } }, 'readiness check failed');
    return fail(c, 503, NOT_READY_ERROR_CODE, 'Database is not reachable', {
      checks: { database },
    });
  });

  return routes;
}

/** A readiness probe must always produce an answer; a throwing probe is a failed check. */
async function probe(check: () => Promise<ReadinessCheck>): Promise<ReadinessCheck> {
  try {
    return await check();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'probe failed' };
  }
}
