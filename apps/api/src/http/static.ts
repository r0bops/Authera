import type { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { fail, type AppEnv } from './envelope.js';

/** URL namespaces owned by the backend. They never fall through to the SPA. */
export const BACKEND_NAMESPACES = ['/api', '/health', '/ucp', '/.well-known', '/webhooks'] as const;

export function isBackendPath(path: string): boolean {
  return BACKEND_NAMESPACES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Serve the compiled Vite SPA from the API process (single origin in production).
 * - Backend namespaces answer JSON 404s when no route matched.
 * - Files under the dist directory are served as-is.
 * - Every other GET falls back to index.html so client-side routes deep-link.
 */
export function mountSpa(app: Hono<AppEnv>, webDistDir: string): void {
  for (const prefix of BACKEND_NAMESPACES) {
    app.all(`${prefix}/*`, (c) =>
      fail(c, 404, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`),
    );
    app.all(prefix, (c) => fail(c, 404, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`));
  }
  app.get('*', serveStatic({ root: webDistDir }));
  app.get('*', serveStatic({ root: webDistDir, path: 'index.html' }));
}
