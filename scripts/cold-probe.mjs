#!/usr/bin/env node
/**
 * Cold-start probe (performance program, Nov 7 2026).
 *
 *   TARGET_ENV=prod E2E_ALLOW_PROD=1 node scripts/cold-probe.mjs --base https://edgeathlete.ca --label before
 *   node scripts/cold-probe.mjs --base http://localhost:3000                      (staging data, local server)
 *
 * What "slow after I ship an update" is in numbers: the FIRST request to each
 * route of the open path (the feed page as a signed-in person opens it — the
 * document and the dozen API calls that follow) against the same request
 * once the function is warm. Run right after `/api/health` carries a new
 * commit and the first column is the cold start; run hours later and it is
 * still the cold start, because at <10 users every instance has idled out.
 *
 * Phase A fires the open path's requests IN PARALLEL, exactly as one feed
 * open does (so several cold instances may spin up at once — that is the
 * real shape). Phase B repeats each route sequentially four times: the
 * median is the warm number. The report lands in docs/load/<date>/cold-<label>.md
 * with `--out <dir>`.
 *
 * It mints ONE disposable QA user (`edgeqa-coldprobe-<rand>@edgeathlete.ca`,
 * the sweep's prefix — e2e/helpers/qa-sweep-rules.ts) with a private profile,
 * signs in, probes, and deletes the user; `--keep` leaves it for a rerun.
 * Production needs E2E_ALLOW_PROD=1 like the e2e suite. The data side comes
 * from `.env.local` (staging) or, with TARGET_ENV=prod, `.env.prod`.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile, ENV_FILE } from './env-file.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const base = String(flag('--base', 'http://localhost:3000')).replace(/\/$/, '');
const label = String(flag('--label', 'probe'));
const outDir = flag('--out', null);
const keep = args.includes('--keep');
const warmRuns = Number(flag('--runs', 4));

loadEnvFile();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error(`cold-probe: ${ENV_FILE} must carry NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY`);
  process.exit(2);
}
const ref = /https:\/\/([a-z0-9]+)\.supabase\.(?:co|in)/.exec(url)?.[1];
const PROD_REF = 'htwhmdoiszhhmwuflgci';
const PROD_HOSTS = ['edge-athlete.vercel.app', 'edgeathlete.ca', 'www.edgeathlete.ca'];
const host = new URL(base).hostname;
if ((ref === PROD_REF || PROD_HOSTS.includes(host)) && process.env.E2E_ALLOW_PROD !== '1') {
  console.error('cold-probe: REFUSED — production needs E2E_ALLOW_PROD=1 (and TARGET_ENV=prod for .env.prod).');
  process.exit(2);
}
if (PROD_HOSTS.includes(host) && ref !== PROD_REF) {
  console.error('cold-probe: REFUSED — the production app with a non-production env file (set TARGET_ENV=prod).');
  process.exit(2);
}

// The open path as the feed page fires it (src/app/(app)/layout.tsx hosts +
// feed/page.tsx + LiveNowStrip + the sidebar), plus the document itself.
const ROUTES = [
  { name: 'document /feed', path: '/feed', doc: true },
  { name: 'health', path: '/api/health' },
  { name: 'me/pulse', path: '/api/me/pulse' },
  { name: 'notifications', path: '/api/notifications?limit=20' },
  { name: 'messages', path: '/api/messages?limit=30' },
  { name: 'posts (feed)', path: '/api/posts?limit=20' },
  { name: 'drafts', path: '/api/drafts' },
  { name: 'golf live-now', path: '/api/golf/live-now' },
  { name: 'sport-events live-now', path: '/api/sport-events/live-now' },
  { name: 'videos live-now', path: '/api/videos/live-now' },
  { name: 'suggestions', path: '/api/suggestions' },
  { name: 'workout-routines', path: '/api/workout-routines' },
  { name: 'guardian athletes', path: '/api/guardian/athletes' },
];

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Mint the QA user (e2e/helpers/qa-user.ts createQaUser, the parts that matter here).
const rand = randomBytes(4).toString('hex');
const email = `edgeqa-coldprobe-${rand}@edgeathlete.ca`;
// shadowPassword()'s rule (src/lib/auth/shadow-password.ts): production's policy wants every class.
const password = randomBytes(32).toString('base64url') + 'Aa1!';
const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (createErr || !created.user) {
  console.error(`cold-probe: createUser failed: ${createErr?.message}`);
  process.exit(2);
}
const userId = created.user.id;
const { error: profileErr } = await admin.from('profiles').insert({
  id: userId,
  email,
  display_name: 'Edge QA Cold',
  full_name: 'Edge QA Cold',
  first_name: 'Edge',
  last_name: 'Cold',
  visibility: 'private',
  onboarded_at: new Date().toISOString(),
  theme_prefs: { mode: 'off' },
});
const cleanup = async () => {
  if (keep) return;
  await admin.from('profiles').delete().eq('id', userId);
  await admin.auth.admin.deleteUser(userId);
};
if (profileErr) {
  await cleanup();
  console.error(`cold-probe: profile insert failed: ${profileErr.message}`);
  process.exit(2);
}

try {
  const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({ email, password });
  if (signErr || !signIn.session) throw new Error(`sign-in failed: ${signErr?.message}`);
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(signIn.session)).toString('base64url')}`;
  const bypass = /\.vercel\.app$/.test(host) && process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
  const headers = { cookie, ...bypass, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'user-agent': 'edge-athlete-cold-probe' };

  const one = async (r) => {
    const t = performance.now();
    const res = await fetch(`${base}${r.path}`, { headers, redirect: 'manual', cache: 'no-store' });
    const text = await res.text();
    return { ms: Math.round(performance.now() - t), status: res.status, bytes: text.length, vercelId: res.headers.get('x-vercel-id') ?? '', cache: res.headers.get('x-vercel-cache') ?? '' };
  };

  // Phase A — the open: everything at once, as a feed open does it.
  const t0 = performance.now();
  const first = await Promise.all(ROUTES.map((r) => one(r)));
  const openMs = Math.round(performance.now() - t0);
  // Phase B — warm: each route alone, several times; the median is the warm number.
  const warm = [];
  for (const r of ROUTES) {
    const times = [];
    let last = null;
    for (let i = 0; i < warmRuns; i++) {
      last = await one(r);
      times.push(last.ms);
    }
    times.sort((a, b) => a - b);
    warm.push({ median: times[Math.floor(times.length / 2)], min: times[0], status: last.status });
  }

  const rows = ROUTES.map((r, i) => ({
    route: r.name,
    path: r.path,
    status: first[i].status,
    cold: first[i].ms,
    warm: warm[i].median,
    warmMin: warm[i].min,
    ratio: warm[i].median ? +(first[i].ms / warm[i].median).toFixed(1) : null,
    bytes: first[i].bytes,
    region: first[i].vercelId.split('::')[0],
    cache: first[i].cache,
  }));
  const worst = [...rows].sort((a, b) => b.cold - a.cold)[0];

  console.log(`cold-probe (${label}): ${base} — ${ROUTES.length} requests of the open path at once, then ${warmRuns} warm runs each\n`);
  console.log('route'.padEnd(24) + 'status'.padEnd(8) + 'first ms'.padEnd(10) + 'warm ms'.padEnd(9) + 'ratio'.padEnd(7) + 'bytes'.padEnd(9) + 'region');
  for (const r of rows) console.log(r.route.padEnd(24) + String(r.status).padEnd(8) + String(r.cold).padEnd(10) + String(r.warm).padEnd(9) + String(r.ratio ?? '—').padEnd(7) + String(r.bytes).padEnd(9) + r.region + (r.cache ? ` ${r.cache}` : ''));
  console.log(`\nthe open (all ${ROUTES.length} in parallel, first time): ${openMs} ms · slowest first request: ${worst.route} ${worst.cold} ms (warm ${worst.warm} ms)`);

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `cold-${label}.md`);
    let commit = '';
    try {
      commit = JSON.parse(await (await fetch(`${base}/api/health`, { headers: bypass })).text()).commit?.slice(0, 8) ?? '';
    } catch {
      /* the table is the point */
    }
    const md = [
      `# Cold-start probe — ${label} — ${new Date().toISOString()}`,
      '',
      `Target ${base} (commit ${commit || 'unknown'}), the open path fired at once as one feed open does, then ${warmRuns} warm runs per route (median). The user is a disposable QA account with an empty feed.`,
      '',
      '| route | status | first (ms) | warm (ms) | first / warm | bytes |',
      '| --- | ---: | ---: | ---: | ---: | ---: |',
      ...rows.map((r) => `| ${r.route} | ${r.status} | ${r.cold} | ${r.warm} | ${r.ratio ?? '—'} | ${r.bytes} |`),
      '',
      `The whole open, first time: **${openMs} ms**. Slowest first request: ${worst.route} ${worst.cold} ms (warm ${worst.warm} ms).`,
      '',
    ].join('\n');
    writeFileSync(file, md);
    console.log(`cold-probe: wrote ${file}`);
  }
} finally {
  await cleanup();
}
