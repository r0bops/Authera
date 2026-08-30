import type { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { fail, type AppEnv } from './envelope.js';

/** URL namespaces owned by the backend. They never fall through to the SPA. */
const BACKEND_NAMESPACES = ['/api', '/health', '/ucp', '/.well-known', '/webhooks'] as const;

/**
 * Serve the compiled Vite SPA from the API process (single origin in production).
 * - Backend namespaces answer JSON 404s when no route matched.
 * - Files under the dist directory are served as-is.
 * - Every other GET falls back to index.html so client-side routes deep-link.
 * - /assets/* is immutable (hashed filenames) and 404s when missing; index.html is never cached, so
 *   a redeploy is picked up on the next navigation instead of breaking chunk loads.
 */
export function mountSpa(app: Hono<AppEnv>, webDistDir: string): void {
  for (const prefix of BACKEND_NAMESPACES) {
    app.all(`${prefix}/*`, (c) =>
      fail(c, 404, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`),
    );
    app.all(prefix, (c) => fail(c, 404, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`));
  }
  // Hashed build assets: cache forever, and a missing one is a 404 — never index.html, which a
  // browser holding an older index would otherwise try to run as a JavaScript module.
  app.get(
    '/assets/*',
    serveStatic({
      root: webDistDir,
      onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable'),
    }),
  );
  app.get('/assets/*', (c) => fail(c, 404, 'NOT_FOUND', `No asset at ${c.req.path}`));
  app.get(
    '*',
    serveStatic({
      root: webDistDir,
      // `/` resolves to index.html here, before the fallback below: keep it uncached too.
      onFound: (path, c) => {
        if (path.endsWith('index.html')) c.header('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get(
    '*',
    serveStatic({
      root: webDistDir,
      path: 'index.html',
      onFound: (_path, c) => c.header('Cache-Control', 'no-cache'),
    }),
  );
}
