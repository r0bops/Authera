import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { RequestIdVariables } from 'hono/request-id';
import type { ApiResult } from '@authera/contracts';
import type { SessionRow, UserRow } from '@authera/db';
import type { Logger } from '../logger.js';
import type { VerifiedAgentRequest } from '../middleware/agent-signature.js';

export interface AppVariables extends RequestIdVariables {
  logger: Logger;
  user?: UserRow;
  session?: SessionRow;
  agentRequest?: VerifiedAgentRequest;
}

export type AppEnv = { Variables: AppVariables };

export type AppContext = Context<AppEnv>;

/** Success envelope: { ok: true, data, requestId }. */
export function ok<T>(c: AppContext, data: T, status: ContentfulStatusCode = 200) {
  const body: ApiResult<T> = { ok: true, data, requestId: c.get('requestId') };
  return c.json(body, status);
}

/** Error envelope: { ok: false, error: { code, message, details? }, requestId }. */
export function fail(
  c: AppContext,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: unknown,
) {
  const body: ApiResult<never> = {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
    requestId: c.get('requestId'),
  };
  return c.json(body, status);
}
