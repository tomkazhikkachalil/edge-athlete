#!/usr/bin/env node
/**
 * The post-deploy warm step (performance program, PR 1b — Nov 2026).
 *
 *   node scripts/warm.mjs --base https://edgeathlete.ca --expect <commit sha> [--timeout-ms 600000]
 *
 * WHY. At <10 users every function instance has idled out by the time the
 * next person opens the app, and a deploy replaces every instance anyway —
 * so the first open after a merge pays the cold start of each function the
 * open path touches (measured Nov 7 2026: 1.5–1.8 s per API route before the
 * function diet, the whole feed open 1.8 s). Fluid Compute keeps a warmed
 * instance for the requests that follow, so ONE pass over the open path
 * right after the deploy is ready means the first real open finds warm
 * functions. The pass needs NO session: a 401 still loads the function.
 *
 * WHAT. Wait until `/api/health` carries the expected commit (the deploy is
 * live), then fire the open path — the document, the health route and the
 * dozen API routes a feed open calls — in parallel (one cold instance per
 * function group), then once more sequentially to print the warm number
 * beside the cold one. Best-effort: a slow or refused route is printed, never
 * fatal; the only failure is a deploy that never shows the sha (exit 1, so
 * the workflow run says so).
 */
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const base = String(flag('--base', 'https://edgeathlete.ca')).replace(/\/$/, '');
const expect = String(flag('--expect', '')).trim();
const timeoutMs = Number(flag('--timeout-ms', 600_000));

/** The open path, as src/app/(app)/layout.tsx + feed/page.tsx fire it. */
export const WARM_PATHS = [
  '/',
  '/api/health',
  '/api/me/pulse',
  '/api/notifications?limit=20',
  '/api/messages?limit=30',
  '/api/posts?limit=20',
  '/api/drafts',
  '/api/golf/live-now',
  '/api/sport-events/live-now',
  '/api/videos/live-now',
  '/api/suggestions',
  '/api/workout-routines',
  '/api/guardian/athletes',
  '/api/profile?id=00000000-0000-4000-8000-000000000000',
  '/api/search?q=warm',
  '/manifest.webmanifest',
];

const headers = { 'user-agent': 'edge-athlete-warm', accept: 'text/html,application/json;q=0.9,*/*;q=0.8' };

async function healthCommit() {
  try {
    const res = await fetch(`${base}/api/health`, { headers, cache: 'no-store' });
    const body = await res.json();
    return typeof body.commit === 'string' ? body.commit : '';
  } catch {
    return '';
  }
}

async function timed(path) {
  const t = performance.now();
  try {
    const res = await fetch(`${base}${path}`, { headers, redirect: 'manual', cache: 'no-store' });
    await res.arrayBuffer();
    return { path, status: res.status, ms: Math.round(performance.now() - t) };
  } catch (err) {
    return { path, status: 0, ms: Math.round(performance.now() - t), error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  if (expect) {
    const deadline = Date.now() + timeoutMs;
    let seen = '';
    while (Date.now() < deadline) {
      seen = await healthCommit();
      if (seen && seen.startsWith(expect)) break;
      await new Promise(r => setTimeout(r, 10_000));
    }
    if (!seen || !seen.startsWith(expect)) {
      console.error(`warm: ${base} never reported commit ${expect} (last seen ${seen || 'none'}) within ${Math.round(timeoutMs / 1000)} s`);
      process.exit(1);
    }
    console.log(`warm: ${base} is on ${seen.slice(0, 8)}`);
  }
  const t0 = performance.now();
  const cold = await Promise.all(WARM_PATHS.map(timed));
  const coldMs = Math.round(performance.now() - t0);
  await new Promise(r => setTimeout(r, 1_500));
  const warm = [];
  for (const p of WARM_PATHS) warm.push(await timed(p));
  console.log('path'.padEnd(56) + 'status'.padEnd(8) + 'first ms'.padEnd(10) + 'second ms');
  cold.forEach((c, i) => console.log(c.path.padEnd(56) + String(c.status).padEnd(8) + String(c.ms).padEnd(10) + String(warm[i].ms) + (c.error ? `  (${c.error})` : '')));
  console.log(`warm: ${WARM_PATHS.length} routes, the parallel pass ${coldMs} ms; the functions the open path touches are warm.`);
}

if (process.argv[1] && /warm\.mjs$/.test(process.argv[1])) await main();
