#!/usr/bin/env node
/**
 * `node scripts/db-trace-inventory.mjs [--port 3100] [--out docs/load/<date>/trips.md]`
 *
 * The trip inventory (post-audit refinements, item 5 PR 0): starts the BUILT
 * app (`npm run start`) with `EA_TRACE_DB=1` on a spare port against STAGING
 * (.env.local), signs one seed user in, and sends ONE request at a time to
 * each hot route, counting the `[db-trace]` lines the server prints between
 * requests — the database trips that request made. Serial on purpose: the
 * counter is process-wide. Each route is requested twice and the second
 * count is kept (the first warms module-level caches such as the admin
 * client and the sport registry). Output: a markdown table (route · trips ·
 * ms · the distinct paths), the §7 table of docs/SCALE_AUDIT.md.
 *
 * Needs `npm run build` done first. STAGING ONLY (the env check).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const readEnv = (file) => { try { return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; })); } catch { return {}; } };
const env = { ...readEnv('.env.local'), ...readEnv('.env.staging') };
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const port = Number(opt('--port', '3100'));
const out = opt('--out', path.join('docs', 'load', new Date().toISOString().slice(0, 10), 'trips.md'));
if (!env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL.includes('htwhmdoiszhhmwuflgci')) { console.error('db-trace-inventory: STAGING ONLY'); process.exit(2); }
if (!env.SEED_PASSWORD) { console.error('db-trace-inventory: SEED_PASSWORD missing — run scripts/staging-seed.mjs first.'); process.exit(2); }

// ── a session for the requests ───────────────────────────────────────────────
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: signed, error: signErr } = await anon.auth.signInWithPassword({ email: 'seed-0001@staging.invalid', password: env.SEED_PASSWORD });
if (signErr || !signed.session) { console.error('sign-in failed:', signErr?.message); process.exit(1); }
const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(signed.session)).toString('base64url')}`;
const { data: subject } = await admin.from('profiles').select('id, handle').eq('email', 'seed-subject@staging.invalid').maybeSingle();
const { data: aPost } = await admin.from('posts').select('id').like('caption', 'Seed post %').eq('visibility', 'public').order('created_at', { ascending: false }).limit(1).maybeSingle();

// ── the server, traced ───────────────────────────────────────────────────────
const lines = [];
const server = spawn('npm', ['run', 'start'], { env: { ...process.env, PORT: String(port), EA_TRACE_DB: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const onData = (buf) => { for (const l of String(buf).split('\n')) if (l.includes('[db-trace]')) lines.push(l.slice(l.indexOf('[db-trace]') + 11).trim()); };
server.stdout.on('data', onData); server.stderr.on('data', onData);
const base = `http://localhost:${port}`;
for (let i = 0; i < 120; i++) { try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 1000)); }

// ── the writes' subjects (Nov 7 2026): a conversation with the seed subject and a public golf round of our own — the round is deleted at the end, the comments / posts / messages the passes leave are swept below.
const postJson = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) { console.error(`${p} → ${r.status}`); return null; } return r.json(); };
const conv = await postJson('/api/messages', { type: 'direct', participantId: subject?.id });
const conversationId = conv?.conversationId ?? null;
const round = await postJson('/api/group-posts', { type: 'golf_round', title: `Trips ${Date.now()}`, date: new Date().toISOString().slice(0, 10), visibility: 'public', participant_ids: [], golf_data: { course_name: 'Trips Links', round_type: 'outdoor', holes_played: 9 } });
const roundId = round?.group_post?.id ?? null;

const ROUTES = [
  ['GET /api/health (reference)', `/api/health`, {}],
  ['GET /api/posts (the feed)', `/api/posts?limit=20`, { cookie }],
  ['GET /api/posts?postId= (one post)', `/api/posts?postId=${aPost?.id}`, { cookie }],
  ['GET /api/profile/{id}/media', `/api/profile/${subject?.id}/media`, { cookie }],
  ['GET /api/public/profile?handle=', `/api/public/profile?handle=${subject?.handle}`, {}],
  ['GET /api/messages (the list)', `/api/messages`, { cookie }],
  ['GET /api/messages/unread-count', `/api/messages/unread-count`, { cookie }],
  ['GET /api/notifications?limit=20', `/api/notifications?limit=20`, { cookie }],
  ['GET /api/notifications/unread-count', `/api/notifications/unread-count`, { cookie }],
  ['GET /api/search?q=seed', `/api/search?q=seed`, { cookie }],
  ['GET /api/golf/live-now', `/api/golf/live-now`, { cookie }],
  ['GET /api/me/pulse', `/api/me/pulse`, { cookie }],
  ['GET /api/comments?postId= (page one)', `/api/comments?postId=${aPost?.id}`, { cookie }],
  ['GET /api/mentions/search?q=seed', `/api/mentions/search?q=seed`, { cookie }],
  ['GET /api/calendar/invite-search?q=seed', `/api/calendar/invite-search?q=seed`, { cookie }],
  ['GET /api/suggestions?profileId=me', `/api/suggestions?profileId=${signed.user?.id}`, { cookie }],
  ['POST /api/posts/like (toggle)', `/api/posts/like`, { cookie, method: 'POST', body: JSON.stringify({ postId: aPost?.id }) }],
  // Nov 7 2026: the writes and the live reads the audit's §1.3 / §1.4 / §1.6 name.
  ['GET /api/messages/{id} (the thread)', `/api/messages/${conversationId}`, { cookie }],
  ['POST /api/messages/{id}/messages (send text)', `/api/messages/${conversationId}/messages`, { cookie, method: 'POST', body: JSON.stringify({ type: 'text', content: 'trips' }) }],
  ['POST /api/comments (create)', `/api/comments`, { cookie, method: 'POST', body: JSON.stringify({ postId: aPost?.id, content: 'trips' }) }],
  ['POST /api/posts (a general post)', `/api/posts`, { cookie, method: 'POST', body: JSON.stringify({ postType: 'general', caption: 'trips', visibility: 'public' }) }],
  ['POST /api/follow (toggle)', `/api/follow`, { cookie, method: 'POST', body: JSON.stringify({ followingId: subject?.id }) }],
  ['GET /api/group-posts/{id}/scorecard', `/api/group-posts/${roundId}/scorecard`, { cookie }],
  ['GET /api/live/cheers?context=group_post:', `/api/live/cheers?context=group_post:${roundId}`, { cookie }],
  ['GET /api/golf/live-now/count', `/api/golf/live-now/count`, { cookie }],
  ['GET /api/sport-events/live-now', `/api/sport-events/live-now`, { cookie }],
];
const rows = [];
for (const [name, p, o] of ROUTES) {
  let kept = null;
  for (let pass = 0; pass < 2; pass++) {
    const start = lines.length; const t = Date.now();
    const res = await fetch(base + p, { method: o.method ?? 'GET', headers: { ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.body ? { 'content-type': 'application/json' } : {}) }, body: o.body });
    await res.arrayBuffer();
    const ms = Date.now() - t;
    await new Promise(r => setTimeout(r, 700)); // the route's after-response work (the limiter's RPC, fan-out) lands too
    const made = lines.slice(start);
    kept = { name, status: res.status, ms, trips: made.length, paths: [...new Set(made.map(l => l.replace(/\?.*$/, '')))] };
  }
  rows.push(kept);
  console.log(`${kept.name.padEnd(44)} ${String(kept.status).padStart(3)}  ${String(kept.trips).padStart(3)} trips  ${String(kept.ms).padStart(5)} ms`);
}
// The subjects go: the round through its route, the passes' comments / posts / messages through the admin client (seed data on staging).
if (roundId) await fetch(`${base}/api/group-posts/${roundId}`, { method: 'DELETE', headers: { cookie } }).catch(() => null);
await admin.from('post_comments').delete().eq('profile_id', signed.user.id).eq('content', 'trips');
await admin.from('posts').delete().eq('profile_id', signed.user.id).eq('caption', 'trips');
if (conversationId) await admin.from('messages').delete().eq('conversation_id', conversationId).eq('content', 'trips');
server.kill('SIGTERM');

fs.mkdirSync(path.dirname(out), { recursive: true });
const md = [`# Database trips per request — ${new Date().toISOString().slice(0, 10)} (built app, EA_TRACE_DB=1, staging, one request at a time; the second of two passes)`, '', `Caveat: \`GET auth:user\` is the session check over the network — a local build without SUPABASE_JWT_SECRET pays it on every authenticated request; production verifies the JWT locally, so subtract one trip per authenticated route there.`, '',
  '| Route | Status | Trips | ms (local → staging) | Distinct paths |', '| --- | ---: | ---: | ---: | --- |',
  ...rows.map(r => `| ${r.name} | ${r.status} | **${r.trips}** | ${r.ms} | ${r.paths.map(x => `\`${x.replace('/rest/v1/', '').replace('/auth/v1/', 'auth:')}\``).join(' ')} |`), ''].join('\n');
fs.writeFileSync(out, md);
console.log(`\ndb-trace-inventory: ${rows.length} routes → ${out}`);
process.exit(0);
