import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ReadinessCheck } from '@authera/contracts';
import * as schema from './schema.js';

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type Database = NodePgDatabase<typeof schema>;
/** A drizzle database or an open transaction — repositories accept either. */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

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

export function createDatabase(pool: DatabasePool): Database {
  return drizzle(pool, { schema });
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

/** Readiness for migrations: the audit chain head row exists only after the schema migrated. */
export async function checkMigrationsApplied(
  pool: DatabasePool,
  options: CheckDatabaseOptions = {},
): Promise<ReadinessCheck> {
  const timeoutMs = options.timeoutMs ?? 2_500;
  const startedAt = performance.now();
  try {
    const result = await withTimeout(
      pool.query<{ ok: boolean }>(
        "SELECT to_regclass('public.audit_chain_heads') IS NOT NULL AS ok",
      ),
      timeoutMs,
    );
    if (!result.rows[0]?.ok) return { ok: false, error: 'schema not migrated' };
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

/** PostgreSQL unique-violation detection (SQLSTATE 23505), also through Drizzle's wrapped `cause`. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
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
