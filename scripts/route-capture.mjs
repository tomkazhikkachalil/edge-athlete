#!/usr/bin/env node
/**
 * `node scripts/route-capture.mjs --base <url> --out <file.json> --path <p> [--path <p> …] [--user seed-0001@staging.invalid]`
 * `node scripts/route-capture.mjs --diff <before.json> <after.json>`
 *
 * The trip-count program's equality harness (Oct 26 2026): a route PR must
 * not change one byte of a response's JSON. Capture each path's status and
 * body before the change (the current build) and after (the new build);
 * `--diff` deep-compares and names the first differing key path per route.
 * With `--user`, the seed user's session cookie rides every request (STAGING
 * ONLY — the Supabase project is .env.local, and a production host is refused).
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const readEnv = (file) => { try { return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; })); } catch { return {}; } };
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const all = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));

function deepDiff(a, b, path = '$') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return `${path}: ${JSON.stringify(a)?.slice(0, 80)} → ${JSON.stringify(b)?.slice(0, 80)}`;
  if (typeof a !== 'object') return `${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${path}.length: ${a.length} → ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = deepDiff(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of [...keys].sort()) { const d = deepDiff(a[k], b[k], `${path}.${k}`); if (d) return d; }
  return null;
}

if (args[0] === '--diff') {
  const a = JSON.parse(fs.readFileSync(args[1], 'utf8')), b = JSON.parse(fs.readFileSync(args[2], 'utf8'));
  let same = 0;
  for (const p of Object.keys(a)) {
    if (!(p in b)) { console.log(`MISSING ${p}`); continue; }
    const d = a[p].status !== b[p].status ? `status ${a[p].status} → ${b[p].status}` : deepDiff(a[p].body, b[p].body);
    if (d) console.log(`DIFFERS  ${p}\n         ${d}`); else { same++; console.log(`identical ${p} (${a[p].status})`); }
  }
  console.log(`\n${same} of ${Object.keys(a).length} responses identical`);
  process.exit(same === Object.keys(a).length ? 0 : 1);
}

const env = { ...readEnv('.env.local'), ...readEnv('.env.staging') };
const base = (opt('--base', 'http://localhost:3000')).replace(/\/$/, '');
const host = new URL(base).hostname;
if (/edgeathlete\.ca$|^edge-athlete\.vercel\.app$|-git-(main|master)-/.test(host)) { console.error('route-capture: REFUSED — a production host'); process.exit(2); }
if (!env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL.includes('htwhmdoiszhhmwuflgci')) { console.error('route-capture: STAGING ONLY'); process.exit(2); }
const out = opt('--out'); const paths = all('--path'); const user = opt('--user', '');
if (!out || !paths.length) { console.error('usage: --base <url> --out <file> --path <p> [--path …] [--user <seed email>]'); process.exit(2); }
let cookie = '';
if (user) {
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: user, password: env.SEED_PASSWORD });
  if (error || !data.session) { console.error('sign-in failed:', error?.message); process.exit(1); }
  cookie = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`;
}
const result = {};
for (const p of paths) {
  const res = await fetch(base + p, { headers: cookie ? { cookie } : {} });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 500) }; }
  result[p] = { status: res.status, body };
  console.log(`${String(res.status).padStart(3)}  ${p}  (${text.length} bytes)`);
}
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`route-capture: ${paths.length} responses → ${out}`);
