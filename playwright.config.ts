import { defineConfig } from '@playwright/test';

/**
 * Smoke suite — runs against a real Supabase backend (there is no staging
 * project; global setup creates a disposable private-visibility QA user and
 * teardown always deletes it). Locally the env comes from .env.local (loaded
 * by the helpers for setup, and by next itself for the server); in CI the
 * `smoke` job injects repo secrets and skips green when they are absent.
 *
 * webServer readiness pings `/` (public, 200 without auth) rather than
 * /api/health: Playwright treats a non-2xx as "not ready yet", which would
 * turn a mis-envved 503 into an opaque timeout. health.spec.ts asserts the
 * health endpoint explicitly instead, as the suite's first real check.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // One worker: specs share a single QA user, and feed-post asserts on that
  // user's own content — parallel specs could interleave.
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    // Layout must be measured with mobile emulation OFF — under emulation
    // Chrome expands the layout viewport and real overflows read as clean.
    isMobile: false,
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
    storageState: 'e2e/.auth/state.json',
  },
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000/',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
