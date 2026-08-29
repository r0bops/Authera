import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../http/envelope.js';
import type { Logger } from '../logger.js';

/**
 * Attaches a request-scoped child logger and logs one completion line per request.
 * Health probes log at debug level so one-second demo polling does not flood output.
 */
export function requestLogger(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId = c.get('requestId');
    const child = logger.child({ requestId });
    c.set('logger', child);

    const startedAt = performance.now();
    await next();
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;

    const status = c.res.status;
    const path = c.req.path;
    const level =
      status >= 500
        ? 'error'
        : status >= 400
          ? 'warn'
          : path.startsWith('/health/')
            ? 'debug'
            : 'info';
    child[level]({ method: c.req.method, path, status, durationMs }, 'request completed');
  };
}
