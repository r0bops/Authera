import type { MiddlewareHandler } from 'hono';
import { IDEMPOTENCY_KEY_HEADER } from '@agentcerta/contracts';
import {
  abandonIdempotent,
  beginIdempotent,
  completeIdempotent,
  type Database,
} from '@agentcerta/db';
import { hashCanonical } from '@agentcerta/domain';
import type { AppEnv } from '../http/envelope.js';
import { ApiProblem } from '../http/problem.js';

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Idempotency-Key for state-changing human/demo endpoints (spec §12). The key is scoped to the
 * user and route; a replay returns the stored response, a different payload under the same
 * key is a conflict, and a concurrent duplicate is told to retry.
 */
export function idempotent(scopeName: string, db: Database): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
    if (!key || !KEY_PATTERN.test(key)) {
      throw new ApiProblem(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        `${IDEMPOTENCY_KEY_HEADER} header (8-128 chars) is required`,
      );
    }
    const user = c.get('user');
    const scope = `${scopeName}:${user?.id ?? 'anonymous'}:${c.req.method} ${c.req.path}`;
    const rawBody = await c.req.text();
    let parsed: unknown = null;
    if (rawBody.length > 0) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new ApiProblem(400, 'INVALID_JSON', 'Request body must be valid JSON');
      }
    }
    const requestHash = hashCanonical(parsed);

    const claim = await beginIdempotent(db, { scope, key, requestHash });
    switch (claim.kind) {
      case 'replay': {
        c.header('Idempotency-Replayed', 'true');
        return c.json(claim.body as object, claim.status as 200);
      }
      case 'mismatch':
        throw ApiProblem.conflict(
          'IDEMPOTENCY_MISMATCH',
          'This Idempotency-Key was already used with a different payload',
        );
      case 'in_progress':
        throw ApiProblem.conflict(
          'IDEMPOTENCY_IN_PROGRESS',
          'A request with this Idempotency-Key is still being processed',
        );
      case 'new':
        break;
    }

    try {
      await next();
    } catch (error) {
      await abandonIdempotent(db, claim.recordId);
      throw error;
    }
    const response = c.res;
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      body = null;
    }
    if (response.status >= 500) {
      await abandonIdempotent(db, claim.recordId);
    } else {
      await completeIdempotent(db, claim.recordId, { status: response.status, body });
    }
  };
}
