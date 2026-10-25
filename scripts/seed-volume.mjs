#!/usr/bin/env node
/**
 * `node scripts/seed-volume.mjs [--users 5000] [--posts 50000] [--conversations 500] [--wipe]`
 *
 * The VOLUME seed for the staging sweep (docs/SCALE_AUDIT.md §3, Oct 25 2026):
 * the sizes a few-thousand-user platform would carry, on STAGING only (the
 * ref check refuses production). It extends scripts/staging-seed.mjs — same
 * users (seed-0001…@staging.invalid, SEED_PASSWORD in .env.staging), same
 * subject (seed-subject@staging.invalid) — and is idempotent: a second run
 * tops up to the requested sizes. `--wipe` is the same as staging-seed's.
 *
 *   • users: created in PARALLEL batches of 20 through auth.admin.createUser
 *     (the serial loop did 500 in 162 s); profiles inserted 100 at a time
 *   • follows: a power-law graph — everyone follows the subject; the first
 *     50 users are "popular" (each followed by ~10 % of everyone); each user
 *     follows ~12 others at random
 *   • posts: public published posts with a caption, so each one is a search
 *     document (posts_search_doc) — 50,000 posts + 5,000 athletes ≈ 55,000
 *     documents; 1 in 5 carries a stat line; 1 in 25 is private
 *   • conversations: direct threads between random pairs, 5 messages each
 *
 * Paced: 200 rows a statement, a breath between batches, and the batch time
 * is watched — over 1 s the pace halves (the staging exhaustion trap, Oct 16).
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

const PROD_REF = 'htwhmdoiszhhmwuflgci';
const args = process.argv.slice(2);
const num = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : Number(args[i + 1]); };
const SIZES = { users: num('--users', 5000), posts: num('--posts', 50000), conversations: num('--conversations', 500) };
const wipe = args.includes('--wipe');

const env = {};
for (const file of ['.env.local', '.env.staging']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* absent */ }
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url ?? '')?.[1];
if (!ref || ref === PROD_REF) {
  console.error(`seed-volume: REFUSED — .env.local points at ${ref ?? 'nothing'}; the seed runs on STAGING only.`);
  process.exit(2);
}
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let password = env.SEED_PASSWORD;
if (!password) {
  password = `Seed-${randomBytes(9).toString('base64url')}!1`;
  writeFileSync('.env.staging', readFileSync('.env.staging', 'utf8').replace(/\n?$/, '\n') + `SEED_PASSWORD=${password}\n`);
  console.log('seed-volume: SEED_PASSWORD written to .env.staging');
}

const SUBJECT_EMAIL = 'seed-subject@staging.invalid';
const emailOf = i => `seed-${String(i).padStart(4, '0')}@staging.invalid`;
const rand = n => Math.floor(Math.random() * n);
const pick = arr => arr[rand(arr.length)];
const daysAgo = d => new Date(Date.now() - d * 86_400_000).toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const elapsed = () => `${Math.round((Date.now() - t0) / 1000)} s`;

// Pacing: the time of the last statement decides the breath before the next.
let breath = 60;
async function paced(label, fn) {
  const started = Date.now();
  let last;
  for (let i = 0; i < 6; i++) {
    const { error, ...rest } = await fn();
    if (!error) {
      const took = Date.now() - started;
      if (took > 1000) { breath = Math.min(4000, breath * 2); console.log(`  slow ${label}: ${took} ms → breath ${breath} ms`); }
      else if (took < 300 && breath > 60) breath = Math.max(60, Math.floor(breath / 2));
      await sleep(breath);
      return rest;
    }
    last = error;
    if (/already been registered|duplicate key|violates/i.test(error.message)) break;
    await sleep(1500 * (i + 1));
  }
  throw new Error(`${label}: ${last?.message}`);
}

async function listSeedUsers() {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email?.startsWith('seed-') && u.email.endsWith('@staging.invalid')) out.push(u);
    if (data.users.length < 1000) break;
  }
  return out;
}

if (wipe) {
  const users = await listSeedUsers();
  console.log(`seed-volume: wiping ${users.length} seed users…`);
  for (const u of users) {
    await admin.from('notifications').delete().eq('user_id', u.id);
    await admin.from('athlete_performances').delete().eq('profile_id', u.id);
    await admin.from('messages').delete().eq('sender_id', u.id);
    await admin.from('conversation_participants').delete().eq('profile_id', u.id);
    await admin.from('posts').delete().eq('profile_id', u.id);
    await admin.from('follows').delete().or(`follower_id.eq.${u.id},following_id.eq.${u.id}`);
    const { error } = await admin.from('profiles').delete().eq('id', u.id);
    if (error) console.warn(`  profiles delete ${u.email}: ${error.message}`);
    const { error: e2 } = await admin.auth.admin.deleteUser(u.id);
    if (e2 && !/not found/i.test(e2.message)) console.warn(`  deleteUser ${u.email}: ${e2.message}`);
  }
  await admin.from('conversations').delete().like('name', 'seed-volume %');
  console.log('seed-volume: wiped.');
  process.exit(0);
}

// ── Users (parallel batches of 20) ───────────────────────────────────────────
const existing = new Map((await listSeedUsers()).map(u => [u.email, u.id]));
const profiled = new Set();
for (let from = 0; ; from += 1000) {
  const { data } = await admin.from('profiles').select('id').like('email', 'seed-%@staging.invalid').range(from, from + 999);
  for (const r of data ?? []) profiled.add(r.id);
  if (!data || data.length < 1000) break;
}
async function createOne(email) {
  for (let i = 0; i < 6; i++) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { seed: true } });
    if (!error) return data.user.id;
    if (/already been registered/i.test(error.message)) return null;
    await sleep(1500 * (i + 1));
  }
  throw new Error(`createUser ${email} failed`);
}
const wanted = [{ email: SUBJECT_EMAIL, handle: 'seedsubject', first: 'Seed', last: 'Subject', visibility: 'public' }];
for (let i = 1; i <= SIZES.users; i++) wanted.push({ email: emailOf(i), handle: `seedfan${String(i).padStart(4, '0')}`, first: 'Seed', last: `Fan ${i}`, visibility: i % 10 === 0 ? 'private' : 'public' });
const missing = wanted.filter(w => !existing.has(w.email));
console.log(`seed-volume: ${existing.size} seed users exist, creating ${missing.length}…`);
for (let i = 0; i < missing.length; i += 20) {
  const batch = missing.slice(i, i + 20);
  const ids = await Promise.all(batch.map(w => createOne(w.email)));
  if (ids.some(id => id === null)) for (const u of await listSeedUsers()) existing.set(u.email, u.id);
  batch.forEach((w, k) => { if (ids[k]) existing.set(w.email, ids[k]); });
  if ((i / 20) % 25 === 0) console.log(`  users: ${Math.min(i + 20, missing.length)}/${missing.length} (${elapsed()})`);
  await sleep(breath);
}
const profileRows = wanted.filter(w => existing.get(w.email) && !profiled.has(existing.get(w.email))).map(w => ({
  id: existing.get(w.email), email: w.email, display_name: `${w.first} ${w.last}`, full_name: `${w.first} ${w.last}`, first_name: w.first, last_name: w.last,
  handle: w.handle, visibility: w.visibility, onboarded_at: new Date().toISOString(),
}));
for (let i = 0; i < profileRows.length; i += 100) {
  await paced('profiles', () => admin.from('profiles').upsert(profileRows.slice(i, i + 100), { onConflict: 'id', ignoreDuplicates: true }));
}
console.log(`seed-volume: ${profileRows.length} profiles inserted (${elapsed()})`);
const subjectId = existing.get(SUBJECT_EMAIL);
const followerIds = wanted.slice(1).map(w => existing.get(w.email)).filter(Boolean);

// ── Follows (power law) ──────────────────────────────────────────────────────
const { count: followsNow } = await admin.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', subjectId);
if ((followsNow ?? 0) < followerIds.length) {
  const rows = [];
  const seen = new Set();
  const add = (a, b) => { if (a === b || seen.has(`${a}>${b}`)) return; seen.add(`${a}>${b}`); rows.push({ follower_id: a, following_id: b, status: 'accepted', created_at: daysAgo(rand(365)) }); };
  for (const f of followerIds) add(f, subjectId);
  for (const f of followerIds.slice(0, 300)) add(subjectId, f);
  const popular = followerIds.slice(0, 50);
  for (const f of followerIds) {
    for (const p of popular) if (Math.random() < 0.1) add(f, p);
    for (let k = 0; k < 12; k++) add(f, pick(followerIds));
  }
  for (let i = 0; i < rows.length; i += 200) {
    await paced('follows', () => admin.from('follows').upsert(rows.slice(i, i + 200), { onConflict: 'follower_id,following_id', ignoreDuplicates: true }));
    if ((i / 200) % 50 === 0) console.log(`  follows: ${i}/${rows.length} (${elapsed()})`);
  }
  console.log(`seed-volume: ${rows.length} follows (${elapsed()})`);
} else console.log(`seed-volume: follows present (${followsNow} on the subject)`);

// ── Posts (each a search document) ───────────────────────────────────────────
const { count: postsNow } = await admin.from('posts').select('id', { count: 'exact', head: true }).like('caption', 'Seed post %');
const wantPosts = Math.max(0, SIZES.posts - (postsNow ?? 0));
const WORDS = ['tournament', 'practice', 'kanata', 'ottawa', 'playoff', 'season', 'drill', 'birdie', 'sprint', 'recovery', 'coach', 'final', 'rink', 'court', 'range', 'pb', 'team', 'camp'];
if (wantPosts > 0) {
  console.log(`seed-volume: inserting ${wantPosts} posts…`);
  for (let done = 0; done < wantPosts; ) {
    const rows = [];
    for (let k = 0; k < Math.min(200, wantPosts - done); k++) {
      const i = (postsNow ?? 0) + done + k;
      const bySubject = i % 100 === 0;
      const stat = i % 5 === 0;
      rows.push({
        profile_id: bySubject ? subjectId : pick(followerIds),
        caption: `Seed post ${i} — ${pick(WORDS)} ${pick(WORDS)} ${stat ? 'stat line' : 'plain post'} #${pick(WORDS)}`,
        visibility: i % 25 === 0 ? 'private' : 'public',
        sport_key: stat ? (i % 2 ? 'ice_hockey' : 'basketball') : null,
        stats_data: stat ? (i % 2 ? { goals: rand(4), assists: rand(4), shots: 1 + rand(8) } : { points: rand(30), rebounds: rand(12), assists: rand(10) }) : null,
        created_at: daysAgo(Math.random() * 400),
      });
    }
    await paced('posts', () => admin.from('posts').insert(rows));
    done += rows.length;
    if ((done / 200) % 25 === 0) console.log(`  posts: ${done}/${wantPosts} (${elapsed()})`);
  }
  console.log(`seed-volume: ${wantPosts} posts (${elapsed()})`);
} else console.log(`seed-volume: posts present (${postsNow})`);

// ── Conversations (direct, 5 messages each) ──────────────────────────────────
const { count: convNow } = await admin.from('conversations').select('id', { count: 'exact', head: true }).like('name', 'seed-volume %');
const wantConv = Math.max(0, SIZES.conversations - (convNow ?? 0));
if (wantConv > 0) {
  for (let i = 0; i < wantConv; i++) {
    const a = i % 10 === 0 ? subjectId : pick(followerIds);
    let b = pick(followerIds); while (b === a) b = pick(followerIds);
    const { data: conv } = await paced('conversation', () => admin.from('conversations').insert({ type: 'direct', name: `seed-volume ${i}`, created_by: a }).select('id').single());
    await paced('participants', () => admin.from('conversation_participants').insert([{ conversation_id: conv.id, profile_id: a }, { conversation_id: conv.id, profile_id: b }]));
    const msgs = Array.from({ length: 5 }, (_, k) => ({ conversation_id: conv.id, sender_id: k % 2 ? b : a, type: 'text', content: `seed message ${k} in ${i}`, created_at: daysAgo(Math.random() * 30) }));
    await paced('messages', () => admin.from('messages').insert(msgs));
    if (i % 50 === 0) console.log(`  conversations: ${i}/${wantConv} (${elapsed()})`);
  }
  console.log(`seed-volume: ${wantConv} conversations (${elapsed()})`);
} else console.log(`seed-volume: conversations present (${convNow})`);

const totals = {};
for (const t of ['profiles', 'posts', 'search_documents', 'follows', 'conversations', 'messages']) {
  const { count } = await admin.from(t).select('*', { count: 'exact', head: true });
  totals[t] = count;
}
console.log(`seed-volume: done in ${elapsed()} — subject ${subjectId}`, totals);
