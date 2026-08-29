import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import {
  createSession,
  getSessionByTokenHash,
  getUserById,
  SEED_IDS,
  type Database,
  type SessionRow,
  type UserRow,
} from '@authera/db';
import type { Clock } from '../clock.js';
import type { AppConfig } from '../config.js';
import type { AppContext, AppEnv } from '../http/envelope.js';
import { ApiProblem } from '../http/problem.js';

const SESSION_COOKIE = 'authera_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionDependencies {
  db: Database;
  config: AppConfig;
  clock: Clock;
}

function hashSessionToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/** Resolve the cookie session (if any) into `user` and `session` context variables. */
export function sessionMiddleware(deps: SessionDependencies): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const session = await getSessionByTokenHash(
        deps.db,
        hashSessionToken(token, deps.config.sessionSecret),
      );
      const now = deps.clock.now();
      if (session && !session.revokedAt && session.expiresAt > now) {
        const user = await getUserById(deps.db, session.userId);
        if (user) {
          c.set('user', user);
          c.set('session', session);
        }
      }
    }
    // Demo pages issue several protected queries in parallel on a cold load. Establish the seeded
    // identity here so those requests cannot race the separate /api/me bootstrap request.
    if (!c.get('user') && deps.config.demo.enabled) {
      await issueSession(c, deps, SEED_IDS.marta);
    }
    await next();
  };
}

/** Mint a session for a user and set the HttpOnly cookie. */
export async function issueSession(
  c: AppContext,
  deps: SessionDependencies,
  userId: string,
): Promise<{ user: UserRow; session: SessionRow }> {
  const user = await getUserById(deps.db, userId);
  if (!user) throw ApiProblem.notFound('user');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(deps.clock.now().getTime() + SESSION_TTL_MS);
  const session = await createSession(deps.db, {
    id: randomUUID(),
    userId,
    tokenHash: hashSessionToken(token, deps.config.sessionSecret),
    expiresAt,
  });
  const secure =
    deps.config.nodeEnv === 'production' && deps.config.publicBaseUrl.startsWith('https://');
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  c.set('user', user);
  c.set('session', session);
  return { user, session };
}

/**
 * Demo convenience (spec §11 "seeded authenticated Marta session"): when demo mode is on and no
 * session exists, the seeded human is signed in automatically. Outside demo mode this is a 401.
 */
export async function ensureHuman(
  c: AppContext,
  deps: SessionDependencies,
): Promise<{ user: UserRow; session: SessionRow }> {
  const user = c.get('user');
  const session = c.get('session');
  if (user && session) return { user, session };
  if (!deps.config.demo.enabled) throw ApiProblem.unauthenticated();
  return issueSession(c, deps, SEED_IDS.marta);
}

export function requireHuman(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.get('user')) throw ApiProblem.unauthenticated();
    await next();
  };
}
