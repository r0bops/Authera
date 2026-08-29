import type { MiddlewareHandler } from 'hono';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@agentcerta/contracts';
import type { AppEnv } from '../http/envelope.js';
import { ApiProblem } from '../http/problem.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated state changes (spec §17):
 * - a custom header that cross-site forms cannot set and cross-origin fetch cannot send
 *   without a CORS preflight (which this API never approves), and
 * - when the browser sends Origin / Sec-Fetch-Site, they must be same-origin.
 */
export function csrfGuard(options: { publicBaseUrl: string }): MiddlewareHandler<AppEnv> {
  const publicOrigin = safeOrigin(options.publicBaseUrl);
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (c.req.header(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
      throw ApiProblem.forbidden(`Missing ${CSRF_HEADER}: ${CSRF_HEADER_VALUE} header`);
    }
    const fetchSite = c.req.header('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      throw ApiProblem.forbidden('Cross-site request rejected');
    }
    const origin = c.req.header('origin');
    if (origin) {
      const requestOrigin = safeOrigin(origin);
      const host = c.req.header('host');
      const sameHost =
        host !== undefined && requestOrigin !== undefined && new URL(requestOrigin).host === host;
      if (requestOrigin !== publicOrigin && !sameHost) {
        throw ApiProblem.forbidden('Origin not allowed');
      }
    }
    await next();
  };
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
