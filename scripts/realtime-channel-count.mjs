#!/usr/bin/env node
/**
 * Realtime channels per signed-in page view (scale fix 3, Oct 25 2026 —
 * docs/SCALE_AUDIT.md hole 3). Signs one seed user in, opens /feed in a real
 * Chromium, and counts the `phx_join` frames the page sends on the Realtime
 * socket — the channel count the app actually opens — with the dock closed,
 * then with the dock panel open. STAGING ONLY: the Supabase project is
 * .env.local (staging) and the target host is refused if it is production.
 *
 *   node scripts/realtime-channel-count.mjs --base https://edge-athlete-git-main-….vercel.app
 *   node scripts/realtime-channel-count.mjs --base http://localhost:3000
 *
 * Options: --email seed-0001@staging.invalid (default) · --wait 12000 (ms per
 * phase) · --no-dock (skip the open-dock phase). SEED_PASSWORD comes from
 * .env.staging (written by scripts/staging-seed.mjs); the Vercel bypass
 * secret from the same file is sent when the target is a preview.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const readEnv = (file) => {
  try {
    return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
  } catch { return {}; }
};
const env = { ...readEnv('.env.local'), ...readEnv('.env.staging') };
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const base = (opt('--base', 'http://localhost:3000')).replace(/\/$/, '');
const email = opt('--email', 'seed-0001@staging.invalid');
const wait = Number(opt('--wait', '12000'));
const doDock = !args.includes('--no-dock');

const PROD_REF = 'htwhmdoiszhhmwuflgci';
const url = env.NEXT_PUBLIC_SUPABASE_URL, anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, password = env.SEED_PASSWORD;
if (!url || !anonKey) { console.error('channel-count: .env.local missing'); process.exit(2); }
if (url.includes(PROD_REF)) { console.error('channel-count: refusing the production project'); process.exit(2); }
const host = new URL(base).hostname;
if (/edgeathlete\.ca$|^edge-athlete\.vercel\.app$/.test(host)) { console.error('channel-count: refusing a production host'); process.exit(2); }
if (/-git-(main|master)-/.test(host)) { console.error(`channel-count: refusing ${host} — the production branch's alias, not a preview`); process.exit(2); }
if (!password) { console.error('channel-count: SEED_PASSWORD missing — run scripts/staging-seed.mjs first.'); process.exit(2); }

const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data, error } = await anon.auth.signInWithPassword({ email, password });
if (error || !data.session) { console.error('sign-in failed:', error?.message); process.exit(1); }
const projectRef = new URL(url).hostname.split('.')[0];
const cookie = {
  name: `sb-${projectRef}-auth-token`,
  value: 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url'),
  url: base, expires: -1, httpOnly: false, secure: base.startsWith('https'), sameSite: 'Lax',
};
const headers = /\.vercel\.app$/.test(host) && env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, extraHTTPHeaders: headers });
await ctx.addCookies([cookie]);
const page = await ctx.newPage();

const joins = []; // { topic, at }
const leaves = [];
page.on('websocket', ws => {
  if (!/realtime\/v1\/websocket/.test(ws.url())) return;
  ws.on('framesent', f => {
    try {
      const m = JSON.parse(String(f.payload));
      const topic = m.topic ?? m[2], event = m.event ?? m[3];
      if (event === 'phx_join') joins.push({ topic, at: Date.now() });
      if (event === 'phx_leave') leaves.push({ topic, at: Date.now() });
    } catch { /* not JSON */ }
  });
});

const summarize = (label, since) => {
  const j = joins.filter(x => x.at >= since).map(x => x.topic);
  const l = leaves.filter(x => x.at >= since).map(x => x.topic);
  const kinds = {};
  for (const t of j) { const k = t.replace(/^realtime:/, '').replace(/:[0-9a-f-]{36}$/, ':{id}'); kinds[k] = (kinds[k] ?? 0) + 1; }
  console.log(`\n== ${label}: ${j.length} join(s), ${l.length} leave(s)`);
  for (const [k, n] of Object.entries(kinds).sort()) console.log(`   ${String(n).padStart(3)} × ${k}`);
};

const t0 = Date.now();
const nav = await page.goto(`${base}/feed`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(wait);
console.log(`landed on ${page.url()} (${nav?.status()})`);
const signedIn = await page.locator('[data-testid="chat-widget"]').count();
if (!signedIn) console.log('(no chat widget on screen — signed out, or the dock is hidden/suppressed; the dock phase will be skipped)');
summarize(`/feed, dock closed (${email}, ${Math.round(wait / 1000)} s)`, t0);

if (doDock && signedIn) {
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Messages dock' }).click();
  await page.waitForTimeout(Math.min(wait, 8000));
  summarize('after opening the dock panel', t1);
  const t2 = Date.now();
  await page.getByRole('button', { name: 'Close messages' }).click();
  await page.waitForTimeout(4000);
  summarize('after closing the dock', t2);
}
console.log(`\nTOTAL open channels at the end: ${joins.length - leaves.length} (joins ${joins.length} − leaves ${leaves.length}); commit: ${await page.evaluate(async b => { try { const r = await fetch(b + '/api/health'); return (await r.json()).commit?.slice(0, 8); } catch { return '?'; } }, base)}`);
await browser.close();
