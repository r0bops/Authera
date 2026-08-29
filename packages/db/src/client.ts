import pg from 'pg';
import type { ReadinessCheck } from '@agentcerta/contracts';

const { Pool } = pg;

export type DatabasePool = pg.Pool;

export interface CreatePoolOptions {
  /** Abort a connection attempt after this many milliseconds (default 2000). */
  connectionTimeoutMillis?: number;
  /** Maximum pooled clients (default 10). */
  max?: number;
}

export function createPool(databaseUrl: string, options: CreatePoolOptions = {}): DatabasePool {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 2_000,
    max: options.max ?? 10,
  });
  // Idle clients can emit errors (e.g. the server restarted). Without a listener the
  // process would crash; the next query surfaces the failure explicitly instead.
  pool.on('error', () => undefined);
  return pool;
}

export interface CheckDatabaseOptions {
  /** Give up waiting for the probe after this many milliseconds (default 2500). */
  timeoutMs?: number;
}

/**
 * Real readiness probe: round-trips `SELECT 1` through the pool. Returns a structured
 * result and never throws, so /health/ready can always answer.
 */
export async function checkDatabaseReady(
  pool: DatabasePool,
  options: CheckDatabaseOptions = {},
): Promise<ReadinessCheck> {
  const timeoutMs = options.timeoutMs ?? 2_500;
  const startedAt = performance.now();
  try {
    await withTimeout(pool.query('SELECT 1 AS ok'), timeoutMs);
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return { ok: false, error: describeDatabaseError(error) };
  }
}

/** Short, credential-free description of a connection failure. */
export function describeDatabaseError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const prefix = typeof code === 'string' && code.length > 0 ? `${code}: ` : '';
    return `${prefix}${error.message}`.slice(0, 200);
  }
  return 'unknown database error';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database probe timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
