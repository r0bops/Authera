import { defineConfig, devices } from '@playwright/test';

/**
 * Trial-by-fire suite (CLAUDE_IMPLEMENTATION_SPEC.md §18). Runs against a live stack:
 *   docker compose up --build   (or `pnpm dev` + a database)
 *   E2E_BASE_URL=http://localhost:3000 pnpm test:e2e
 * Two desktop viewports: 1600×1000 (target) and 1440×900 (must still fit without overlap).
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop-1600',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    },
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
