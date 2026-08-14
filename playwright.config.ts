import { defineConfig } from '@playwright/test';
import { E2E_BASE_URL } from './e2e/helpers/qa-user';

/**
 * Smoke suite — runs against a real Supabase backend (there is no staging
 * project; global setup creates a disposable private-visibility QA user and
 * teardown always deletes it). Locally the env comes from .env.local (loaded
 * by the helpers for setup, and by next itself for the server); in CI the
 * `smoke` job injects repo secrets and skips green when they are absent.
 *
 * Target: localhost by default; set E2E_BASE_URL to smoke a real deployment
 * (the local server is then not started). Either way the DATA side is the
 * same real Supabase project, so this only changes which server is exercised.
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
  // One retry in CI, and one when smoking a real deployment: over a network
  // a cold serverless function can push a 15s assertion window past the edge.
  // That is environmental, NOT a licence to paper over product flakiness —
  // anything that fails twice is treated as a real defect and investigated.
  retries: process.env.CI || !E2E_BASE_URL.includes('localhost') ? 1 : 0,
  // One worker: specs share a single QA user, and feed-post asserts on that
  // user's own content — parallel specs could interleave.
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: E2E_BASE_URL,
    // Layout must be measured with mobile emulation OFF — under emulation
    // Chrome expands the layout viewport and real overflows read as clean.
    isMobile: false,
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
    storageState: 'e2e/.auth/state.json',
  },
  // Only build/serve locally. Targeting a real deployment (E2E_BASE_URL) must
  // NOT spin up a local server — it would be the wrong code under test and
  // would mask whatever is actually deployed.
  webServer: E2E_BASE_URL.includes('localhost')
    ? {
        command: 'npm run build && npm run start',
        url: `${E2E_BASE_URL}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      }
    : undefined,
});
