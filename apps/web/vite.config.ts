import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development Vite serves the SPA and proxies every backend namespace to the API,
// so the browser sees one origin exactly as it does in production.
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';
const BACKEND_NAMESPACES = ['/health', '/api', '/ucp', '/.well-known', '/webhooks', '/agents'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: Object.fromEntries(
      BACKEND_NAMESPACES.map((prefix) => [prefix, { target: API_TARGET, changeOrigin: false }]),
    ),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
