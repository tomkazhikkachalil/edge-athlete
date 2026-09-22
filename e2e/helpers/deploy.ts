import { execSync } from 'child_process';
import { E2E_BASE_URL, PROD_APP_HOST, bypassHeaders } from './qa-user';

/**
 * Wait until the target deployment answers from the commit we expect
 * (Events program, Sep 2026): a prod probe started right after a merge
 * hit the previous build for 2–4 minutes — the first tests waited a
 * minute each for a page that did not exist yet, and the deploy landed
 * mid-run. `/api/health` reports Vercel's build commit; this polls it
 * until it matches `E2E_EXPECT_COMMIT` (default: `origin/main`'s head
 * after a fetch for production; the local HEAD for a preview) or the
 * budget runs out. Localhost skips; a target
 * without a commit (the variable not exposed) warns and continues.
 */
export async function awaitDeployed(opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
  if (E2E_BASE_URL.includes('localhost')) return;
  const timeoutMs = opts.timeoutMs ?? 6 * 60_000;
  const intervalMs = opts.intervalMs ?? 10_000;

  let expected = process.env.E2E_EXPECT_COMMIT ?? '';
  if (!expected) {
    // Production serves origin/main; a PREVIEW serves the pushed branch —
    // expect HEAD there (Round 2, Sep 21 2026).
    const isProd = new URL(E2E_BASE_URL).hostname === PROD_APP_HOST;
    try {
      if (isProd) {
        execSync('git fetch -q origin main', { stdio: 'ignore' });
        expected = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
      } else {
        expected = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      }
    } catch {
      console.warn('[e2e] could not read the expected commit — probing whatever is deployed');
      return;
    }
  }

  const started = Date.now();
  let lastSeen: string | null = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${E2E_BASE_URL}/api/health`, { cache: 'no-store', headers: bypassHeaders() });
      const body = (await res.json().catch(() => ({}))) as { commit?: string | null };
      const commit = typeof body.commit === 'string' ? body.commit : null;
      if (commit === null) {
        console.warn('[e2e] the target reports no build commit — probing whatever is deployed');
        return;
      }
      lastSeen = commit;
      // A short SHA (E2E_EXPECT_COMMIT=08585361) matches by prefix.
      if (commit === expected || (expected.length >= 7 && commit.startsWith(expected))) {
        console.log(`[e2e] target is on ${commit.slice(0, 8)} — probing`);
        return;
      }
    } catch {
      // network blip: keep polling
    }
    if (lastSeen) console.log(`[e2e] waiting for ${expected.slice(0, 8)} — target still on ${lastSeen.slice(0, 8)}`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`[e2e] the target never reached ${expected.slice(0, 8)} (last seen ${lastSeen?.slice(0, 8) ?? 'none'}) within ${Math.round(timeoutMs / 60_000)} min`);
}
