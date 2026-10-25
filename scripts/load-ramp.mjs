#!/usr/bin/env node
/**
 * `node scripts/load-ramp.mjs --base <url> [--steps 5,10,25,50,100] [--seconds 20] [--viewers 20] [--routes all|read|write] [--out docs/load/<date>]`
 *
 * The closed-loop ramp of docs/SCALE_AUDIT.md §3 (Oct 25 2026): N workers,
 * each a signed-in seed user, hit the hot routes back to back for S seconds
 * per step; per route and step: req/s, p50 / p95 / p99, error rate. The
 * step ladder stops at the first step whose p95 > 2 s or error rate > 1 %
 * (the knee is the number); `/api/health` is read between steps and a
 * reading over 1 s pauses the ramp until it recovers (the staging exhaustion
 * trap, Oct 16). STAGING ONLY: the Supabase project is .env.local and a
 * production host is refused; the Vercel bypass secret rides on a preview.
 *
 * Sessions: `--viewers` seed users (seed-0001…, SEED_PASSWORD from
 * .env.staging, created by scripts/staging-seed.mjs or seed-volume.mjs) are
 * signed in once through supabase-js and their sessions become the
 * `sb-<ref>-auth-token` cookie each worker sends — the same cookie the
 * browser holds, so every request walks the middleware and the route's own
 * auth. Output: `<out>/ramp-<timestamp>.json` + `.md` (the §6 table).
 *
 * Routes (the audit's list): GET /api/posts (the feed), GET
 * /api/profile/{id}/media (the subject), GET /api/public/profile?handle=
 * (ISR + CDN), GET /api/messages/unread-count, GET
 * /api/notifications/unread-count, GET /api/search?q= (rotating prefixes),
 * GET /api/golf/live-now, POST /api/posts/like (toggles a like on one of 50
 * seed posts — the write path with its RPCs), GET /api/health (reference).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const readEnv = (file) => { try { return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; })); } catch { return {}; } };
const env = { ...readEnv('.env.local'), ...readEnv('.env.staging') };
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const base = opt('--base', 'http://localhost:3000').replace(/\/$/, '');
const steps = opt('--steps', '5,10,25,50,100').split(',').map(Number);
const seconds = Number(opt('--seconds', '20'));
const viewers = Number(opt('--viewers', '20'));
const routeSet = opt('--routes', 'all');
const outDir = opt('--out', path.join('docs', 'load', new Date().toISOString().slice(0, 10)));

const PROD_REF = 'htwhmdoiszhhmwuflgci';
const url = env.NEXT_PUBLIC_SUPABASE_URL, anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = env.SUPABASE_SERVICE_ROLE_KEY, password = env.SEED_PASSWORD;
if (!url || !anonKey || !service) { console.error('load-ramp: .env.local missing'); process.exit(2); }
if (url.includes(PROD_REF)) { console.error('load-ramp: REFUSED — the production project'); process.exit(2); }
const host = new URL(base).hostname;
if (/edgeathlete\.ca$|^edge-athlete\.vercel\.app$/.test(host)) { console.error('load-ramp: REFUSED — a production host'); process.exit(2); }
if (!password) { console.error('load-ramp: SEED_PASSWORD missing — run scripts/staging-seed.mjs first.'); process.exit(2); }
const bypass = /\.vercel\.app$/.test(host) && env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};

// ── Sessions ─────────────────────────────────────────────────────────────────
const ref = new URL(url).hostname.split('.')[0];
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const sessions = [];
for (let i = 1; i <= viewers; i++) {
  const email = `seed-${String(i).padStart(4, '0')}@staging.invalid`;
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) { console.error(`sign-in ${email}: ${error?.message}`); continue; }
  sessions.push({ id: data.user.id, cookie: `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}` });
}
if (!sessions.length) { console.error('load-ramp: no sessions'); process.exit(1); }
const { data: subject } = await admin.from('profiles').select('id, handle').eq('email', 'seed-subject@staging.invalid').maybeSingle();
const { data: seedPosts } = await admin.from('posts').select('id').like('caption', 'Seed post %').eq('visibility', 'public').limit(50);
const postIds = (seedPosts ?? []).map(p => p.id);
const PREFIXES = ['se', 'seed', 'ott', 'kan', 'fan 12', 'tourn', 'bir', 'pla', 'coa', 'edge'];
console.log(`load-ramp: ${sessions.length} sessions · subject ${subject?.handle ?? '?'} · ${postIds.length} like targets · base ${base}`);

// ── Routes ───────────────────────────────────────────────────────────────────
const routes = [
  { name: 'GET /api/health', kind: 'ref', req: () => ({ path: '/api/health' }) },
  { name: 'GET /api/posts', kind: 'read', req: () => ({ path: '/api/posts?limit=20' }) },
  { name: 'GET /api/profile/{id}/media', kind: 'read', req: () => ({ path: `/api/profile/${subject?.id}/media` }) },
  { name: 'GET /api/public/profile?handle=', kind: 'read', req: () => ({ path: `/api/public/profile?handle=${subject?.handle}`, anon: true }) },
  { name: 'GET /api/messages/unread-count', kind: 'read', req: () => ({ path: '/api/messages/unread-count' }) },
  { name: 'GET /api/notifications/unread-count', kind: 'read', req: () => ({ path: '/api/notifications/unread-count' }) },
  { name: 'GET /api/search?q=', kind: 'read', req: (n) => ({ path: `/api/search?q=${encodeURIComponent(PREFIXES[n % PREFIXES.length])}` }) },
  { name: 'GET /api/golf/live-now', kind: 'read', req: () => ({ path: '/api/golf/live-now' }) },
  { name: 'POST /api/posts/like', kind: 'write', req: (n) => ({ path: '/api/posts/like', method: 'POST', body: JSON.stringify({ postId: postIds[n % postIds.length] }) }) },
].filter(r => routeSet === 'all' || r.kind === routeSet || r.kind === 'ref').filter(r => !(r.kind === 'write' && !postIds.length));

// ── The ramp ─────────────────────────────────────────────────────────────────
const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
async function health() {
  const t = Date.now();
  try { const r = await fetch(`${base}/api/health`, { headers: bypass }); await r.text(); return { ms: Date.now() - t, ok: r.ok }; } catch { return { ms: Infinity, ok: false }; }
}
async function runStep(route, workers) {
  const samples = []; let errors = 0; let n = 0;
  const end = Date.now() + seconds * 1000;
  const worker = async (w) => {
    const s = sessions[w % sessions.length];
    while (Date.now() < end) {
      const k = n++;
      const r = route.req(k);
      const t = Date.now();
      try {
        const res = await fetch(base + r.path, {
          method: r.method ?? 'GET',
          headers: { ...bypass, ...(r.anon ? {} : { cookie: s.cookie }), ...(r.body ? { 'content-type': 'application/json' } : {}) },
          body: r.body,
        });
        await res.arrayBuffer();
        samples.push(Date.now() - t);
        if (!res.ok && res.status !== 429) errors++;
        if (res.status === 429) errors++; // a 429 is the limiter doing its job, but it IS a failed request for the user
      } catch { samples.push(Date.now() - t); errors++; }
    }
  };
  await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
  const sorted = [...samples].sort((a, b) => a - b);
  return { workers, requests: samples.length, rps: +(samples.length / seconds).toFixed(1), p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99), errors, errorRate: samples.length ? +(errors / samples.length * 100).toFixed(2) : 0 };
}

const results = [];
const startedAt = new Date().toISOString();
let commit = '?';
try { commit = (await (await fetch(`${base}/api/health`, { headers: bypass })).json()).commit?.slice(0, 8) ?? '?'; } catch { /* keep ? */ }
for (const route of routes) {
  console.log(`\n== ${route.name}`);
  for (const workers of steps) {
    let h = await health();
    while (h.ms > 1000) { console.log(`  health ${h.ms} ms — pausing 30 s`); await new Promise(r => setTimeout(r, 30_000)); h = await health(); }
    const row = await runStep(route, workers);
    results.push({ route: route.name, ...row, healthBefore: h.ms });
    console.log(`  ${String(workers).padStart(3)} workers · ${String(row.rps).padStart(7)} req/s · p50 ${row.p50} · p95 ${row.p95} · p99 ${row.p99} ms · errors ${row.errorRate} %`);
    if (row.p95 > 2000 || row.errorRate > 1) { console.log(`  STOP: ${row.p95 > 2000 ? 'p95 over 2 s' : 'errors over 1 %'} at ${workers} workers`); break; }
    await new Promise(r => setTimeout(r, 2000));
  }
}

fs.mkdirSync(outDir, { recursive: true });
const stamp = startedAt.replace(/[:.]/g, '-');
fs.writeFileSync(path.join(outDir, `ramp-${stamp}.json`), JSON.stringify({ startedAt, base, commit, seconds, viewers: sessions.length, steps, results }, null, 2));
const md = [`# Load ramp — ${startedAt} · ${base} · commit ${commit}`, '', `Closed-loop workers, ${seconds} s per step, ${sessions.length} signed-in seed sessions. Stop rules: p95 > 2 s or errors > 1 %.`, '', '| Route | Workers | req/s | p50 ms | p95 ms | p99 ms | Errors % |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...results.map(r => `| ${r.route} | ${r.workers} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.errorRate} |`), ''].join('\n');
fs.writeFileSync(path.join(outDir, `ramp-${stamp}.md`), md);
console.log(`\nload-ramp: written ${path.join(outDir, `ramp-${stamp}.{json,md}`)}`);
