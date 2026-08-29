import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
  // Workspace packages ship TypeScript source, so they are bundled into the server.
  // Third-party runtime dependencies stay external and are installed in the image.
  noExternal: [/^@agentcerta\//],
});
