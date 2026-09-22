#!/usr/bin/env node
/**
 * `node scripts/measure-routes.mjs [--base http://localhost:3000] [--runs 12] [--json]`
 *
 * The before/after numbers for Round 3 (the scale cliffs, Sep 2026): p50 /
 * p95 / max wall-clock per hot route, as the seeded SUBJECT on STAGING
 * (`scripts/staging-seed.mjs`), against a local `next start` (the default;
 * build with `.env.local` = staging first) or a Vercel preview (the
 * automation-bypass header goes on when the host is a preview). Two
 * warm-up calls per route are discarded. Never production: the Supabase
 * ref in .env.local is checked; the harness reads, never writes.
 *
 * What a number here means: wall-clock from this machine, so the network
 * to us-west-2 is inside it — compare runs against the SAME base, and read
 * the DB-side cost with EXPLAIN (ANALYZE, BUFFERS) through
 * `scripts/staging-sql.mjs` for the shape itself.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const PROD_REF = 'htwhmdoiszhhmwuflgci';
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const base = String(flag('--base', 'http://localhost:3000')).replace(/\/$/, '');
const runs = Number(flag('--runs', 12));
const asJson = args.includes('--json');

const env = {};
for (const file of ['.env.local', '.env.staging']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* absent */
  }
}
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.NEXT_PUBLIC_SUPABASE_URL ?? '')?.[1];
if (!ref || ref === PROD_REF) {
  console.error('measure-routes: REFUSED — .env.local must point at staging.');
  process.exit(2);
}
if (!env.SEED_PASSWORD) {
  console.error('measure-routes: SEED_PASSWORD missing from .env.staging — run scripts/staging-seed.mjs first.');
  process.exit(2);
}

// Sign in as the subject; the @supabase/ssr cookie shape (e2e/helpers/qa-user.ts mintStorageState).
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email: 'seed-subject@staging.invalid', password: env.SEED_PASSWORD });
if (signInError || !signIn.session) {
  console.error(`measure-routes: sign-in failed: ${signInError?.message}`);
  process.exit(2);
}
const subjectId = signIn.user.id;
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(signIn.session)).toString('base64url')}`;
const host = new URL(base).hostname;
const bypass = /\.vercel\.app$/.test(host) && env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};

const ROUTES = [
  { name: 'public profile (anon)', path: '/api/public/profile?handle=seedsubject', signed: false },
  { name: 'follow stats', path: `/api/follow/stats?profileId=${subjectId}`, signed: true },
  { name: 'feed: following', path: '/api/posts?scope=following&limit=20', signed: true },
  { name: 'feed: default', path: '/api/posts?limit=20', signed: true },
  { name: 'notifications list', path: '/api/notifications?limit=20', signed: true },
  { name: 'notifications unread-count', path: '/api/notifications/unread-count', signed: true },
  { name: 'stat lines (ice_hockey)', path: `/api/sports/stat-lines?profileId=${subjectId}&sport=ice_hockey`, signed: true },
  { name: 'getting started', path: '/api/profile/getting-started', signed: true },
];

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

const results = [];
for (const r of ROUTES) {
  const headers = { ...bypass, ...(r.signed ? { cookie } : {}) };
  const times = [];
  let status = 0;
  let bytes = 0;
  let failed = 0;
  for (let i = 0; i < runs + 2; i++) {
    const t = performance.now();
    let res;
    try {
      res = await fetch(`${base}${r.path}`, { headers, cache: 'no-store' });
      bytes = Number(res.headers.get('content-length')) || (await res.text()).length;
      status = res.status;
    } catch {
      failed++;
      continue;
    }
    const ms = performance.now() - t;
    if (i >= 2) times.push(ms);
    if (res.status >= 400) failed++;
  }
  results.push({ route: r.name, path: r.path, status, bytes, n: times.length, failed, p50: Math.round(pct(times, 50)), p95: Math.round(pct(times, 95)), max: Math.round(Math.max(...times)) });
}

if (asJson) {
  console.log(JSON.stringify({ base, runs, subjectId, results }, null, 2));
} else {
  console.log(`measure-routes: ${base} — ${runs} timed calls per route (2 warm-ups discarded), as seed-subject\n`);
  console.log('route'.padEnd(30) + 'status'.padEnd(8) + 'bytes'.padEnd(9) + 'p50 ms'.padEnd(9) + 'p95 ms'.padEnd(9) + 'max ms');
  for (const r of results) console.log(r.route.padEnd(30) + String(r.status).padEnd(8) + String(r.bytes).padEnd(9) + String(r.p50).padEnd(9) + String(r.p95).padEnd(9) + String(r.max) + (r.failed ? `   (${r.failed} failed)` : ''));
}
