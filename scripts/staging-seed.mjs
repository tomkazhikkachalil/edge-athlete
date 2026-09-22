#!/usr/bin/env node
/**
 * `node scripts/staging-seed.mjs [--users 500] [--posts 2000] [--notifications 5000] [--performances 400] [--wipe]`
 *
 * Synthetic load for STAGING (Round 3 — the scale cliffs, Sep 2026): the
 * shapes the assessment's cliffs are about, in the volumes a 1k-user
 * platform would have for one popular athlete. Refuses the production
 * project outright (the ref check) — this is what staging exists for.
 *
 *   • one SUBJECT (seed-subject@staging.invalid, handle `seedsubject`,
 *     password in .env.staging as SEED_PASSWORD — written on first run)
 *   • N followers (seed-0001…@staging.invalid), every one following the
 *     subject (accepted); the subject follows the first 300; each follower
 *     follows ~10 random others — so the FOLLOWING feed has depth
 *   • posts spread across everyone (public; a few private; some carry a
 *     stat line), 5 % by the subject
 *   • notifications for the subject: likes / comments / follows, plus
 *     org announcements with the `{ org, announcement, site_notice }`
 *     metadata the `.contains()` readers scan
 *   • athlete_performances for the subject across two sports and two
 *     seasons, in the stat-schema vocabulary (the rollup reader's input)
 *
 * Idempotent by email prefix: a second run tops up to the requested sizes
 * (users are matched by email; rows are counted). `--wipe` deletes every
 * seed-* user (profiles cascade) and the subject's notifications.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

const PROD_REF = 'htwhmdoiszhhmwuflgci';
const args = process.argv.slice(2);
const num = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : Number(args[i + 1]);
};
const SIZES = { users: num('--users', 500), posts: num('--posts', 2000), notifications: num('--notifications', 5000), performances: num('--performances', 400) };
const wipe = args.includes('--wipe');

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
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url ?? '')?.[1];
if (!ref || ref === PROD_REF) {
  console.error(`staging-seed: REFUSED — .env.local points at ${ref ?? 'nothing'}; the seed runs on STAGING only.`);
  process.exit(2);
}
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let password = env.SEED_PASSWORD;
if (!password) {
  password = `Seed-${randomBytes(9).toString('base64url')}!1`;
  writeFileSync('.env.staging', readFileSync('.env.staging', 'utf8').replace(/\n?$/, '\n') + `SEED_PASSWORD=${password}\n`);
  console.log('staging-seed: SEED_PASSWORD written to .env.staging');
}

const SUBJECT_EMAIL = 'seed-subject@staging.invalid';
const emailOf = i => `seed-${String(i).padStart(4, '0')}@staging.invalid`;
const rand = n => Math.floor(Math.random() * n);
const pick = arr => arr[rand(arr.length)];
const daysAgo = d => new Date(Date.now() - d * 86_400_000).toISOString();

async function listSeedUsers() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email?.startsWith('seed-') && u.email.endsWith('@staging.invalid')) out.push(u);
    if (data.users.length < 1000) break;
  }
  return out;
}

if (wipe) {
  const users = await listSeedUsers();
  console.log(`staging-seed: wiping ${users.length} seed users…`);
  for (const u of users) {
    await admin.from('notifications').delete().eq('user_id', u.id);
    await admin.from('athlete_performances').delete().eq('profile_id', u.id);
    await admin.from('posts').delete().eq('profile_id', u.id);
    await admin.from('follows').delete().or(`follower_id.eq.${u.id},following_id.eq.${u.id}`);
    const { error } = await admin.from('profiles').delete().eq('id', u.id);
    if (error) console.warn(`  profiles delete ${u.email}: ${error.message}`);
    const { error: e2 } = await admin.auth.admin.deleteUser(u.id);
    if (e2 && !/not found/i.test(e2.message)) console.warn(`  deleteUser ${u.email}: ${e2.message}`);
  }
  console.log('staging-seed: wiped.');
  process.exit(0);
}

// ── Users ────────────────────────────────────────────────────────────────────
const existing = new Map((await listSeedUsers()).map(u => [u.email, u.id]));
/** Free-tier staging answers "statement timeout" on a cold burst; three tries, a breath between. */
async function retry(label, fn) {
  let last;
  for (let i = 0; i < 6; i++) {
    const { error, ...rest } = await fn();
    if (!error) return rest;
    last = error;
    if (/already been registered|duplicate key|violates/i.test(error.message)) break;
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`${label}: ${last?.message}`);
}
const profiled = new Set((await admin.from('profiles').select('id').like('email', 'seed-%@staging.invalid').limit(5000)).data?.map(r => r.id) ?? []);
async function ensureUser(email, handle, first, last, visibility = 'public') {
  let id = existing.get(email);
  if (!id) {
    try {
      const { data } = await retry(`createUser ${email}`, () => admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { seed: true } }));
      id = data.user.id;
    } catch (e) {
      // A create that timed out on the wire but landed: find it by email.
      if (!/already been registered/i.test(String(e.message))) throw e;
      for (const u of await listSeedUsers()) existing.set(u.email, u.id);
      id = existing.get(email);
      if (!id) throw e;
    }
    existing.set(email, id);
  }
  if (!profiled.has(id)) {
    await retry(`profile ${email}`, () => admin.from('profiles').insert({
      id, email, display_name: `${first} ${last}`, full_name: `${first} ${last}`, first_name: first, last_name: last,
      handle, visibility, onboarded_at: new Date().toISOString(),
    }));
    profiled.add(id);
  }
  return id;
}
const subjectId = await ensureUser(SUBJECT_EMAIL, 'seedsubject', 'Seed', 'Subject');
const followerIds = [];
const t0 = Date.now();
for (let i = 1; i <= SIZES.users; i++) {
  followerIds.push(await ensureUser(emailOf(i), `seedfan${String(i).padStart(4, '0')}`, 'Seed', `Fan ${i}`, i % 10 === 0 ? 'private' : 'public'));
  if (i % 100 === 0) console.log(`  users: ${i}/${SIZES.users} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
console.log(`staging-seed: ${followerIds.length} followers + the subject`);

// ── Follows ──────────────────────────────────────────────────────────────────
const { count: followsNow } = await admin.from('follows').select('id', { count: 'exact', head: true }).or(`follower_id.eq.${subjectId},following_id.eq.${subjectId}`);
if ((followsNow ?? 0) < SIZES.users) {
  const rows = [];
  for (const f of followerIds) rows.push({ follower_id: f, following_id: subjectId, status: 'accepted', created_at: daysAgo(rand(365)) });
  for (const f of followerIds.slice(0, 300)) rows.push({ follower_id: subjectId, following_id: f, status: 'accepted', created_at: daysAgo(rand(365)) });
  const seen = new Set();
  for (const f of followerIds) {
    for (let k = 0; k < 10; k++) {
      const g = pick(followerIds);
      const key = `${f}>${g}`;
      if (g === f || seen.has(key)) continue;
      seen.add(key);
      rows.push({ follower_id: f, following_id: g, status: 'accepted', created_at: daysAgo(rand(365)) });
    }
  }
  for (let i = 0; i < rows.length; i += 50) {
    await retry('follows', () => admin.from('follows').upsert(rows.slice(i, i + 50), { onConflict: 'follower_id,following_id', ignoreDuplicates: true }));
  }
  console.log(`staging-seed: ${rows.length} follows`);
} else console.log(`staging-seed: follows present (${followsNow})`);

// ── Posts ────────────────────────────────────────────────────────────────────
const everyone = [subjectId, ...followerIds];
const { count: postsNow } = await admin.from('posts').select('id', { count: 'exact', head: true }).in('profile_id', everyone.slice(0, 1000));
const wantPosts = Math.max(0, SIZES.posts - (postsNow ?? 0));
if (wantPosts > 0) {
  const rows = [];
  for (let i = 0; i < wantPosts; i++) {
    const bySubject = i % 20 === 0;
    const author = bySubject ? subjectId : pick(followerIds);
    const stat = i % 5 === 0;
    rows.push({
      profile_id: author,
      caption: `Seed post ${i} — ${stat ? 'a stat line' : 'a plain post'}`,
      visibility: i % 25 === 0 ? 'private' : 'public',
      sport_key: stat ? (i % 2 ? 'ice_hockey' : 'basketball') : null,
      stats_data: stat ? (i % 2 ? { goals: rand(4), assists: rand(4), shots: 1 + rand(8) } : { points: rand(30), rebounds: rand(12), assists: rand(10) }) : null,
      created_at: daysAgo(Math.random() * 400),
    });
  }
  for (let i = 0; i < rows.length; i += 100) {
    await retry('posts', () => admin.from('posts').insert(rows.slice(i, i + 100)));
  }
  console.log(`staging-seed: ${rows.length} posts`);
} else console.log(`staging-seed: posts present (${postsNow})`);

// ── Notifications for the subject ────────────────────────────────────────────
const { count: notesNow } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', subjectId);
const wantNotes = Math.max(0, SIZES.notifications - (notesNow ?? 0));
if (wantNotes > 0) {
  const orgIds = Array.from({ length: 5 }, () => crypto.randomUUID());
  const rows = [];
  for (let i = 0; i < wantNotes; i++) {
    const kind = i % 10;
    const actor = pick(followerIds);
    const base = { user_id: subjectId, actor_id: actor, is_read: i % 3 !== 0, created_at: daysAgo(Math.random() * 180) };
    if (kind < 5) rows.push({ ...base, type: 'like', title: 'liked your post', metadata: { seed: true } });
    else if (kind < 8) rows.push({ ...base, type: 'comment', title: 'commented on your post', metadata: { seed: true } });
    else if (kind === 8) rows.push({ ...base, type: 'new_follower', title: 'started following you', metadata: { seed: true } });
    else rows.push({ ...base, type: 'club_update', title: 'Club announcement', message: `Announcement ${i}`, metadata: { org: `club:${pick(orgIds)}`, announcement: true, site_notice: i % 2 === 0, seed: true } });
  }
  for (let i = 0; i < rows.length; i += 100) {
    await retry('notifications', () => admin.from('notifications').insert(rows.slice(i, i + 100)));
  }
  console.log(`staging-seed: ${rows.length} notifications`);
} else console.log(`staging-seed: notifications present (${notesNow})`);

// ── Performances for the subject ─────────────────────────────────────────────
const { count: perfNow } = await admin.from('athlete_performances').select('id', { count: 'exact', head: true }).eq('profile_id', subjectId);
const wantPerf = Math.max(0, SIZES.performances - (perfNow ?? 0));
if (wantPerf > 0) {
  const { data: subjectPosts } = await admin.from('posts').select('id').eq('profile_id', subjectId).limit(wantPerf);
  const rows = [];
  for (let i = 0; i < wantPerf; i++) {
    const hockey = i % 2 === 0;
    const sourceId = subjectPosts?.[i]?.id ?? crypto.randomUUID();
    rows.push({
      profile_id: subjectId, sport_key: hockey ? 'ice_hockey' : 'basketball',
      occurred_on: daysAgo(Math.random() * 700).slice(0, 10),
      source: 'post', source_table: 'posts', source_id: sourceId, natural_key: `post:${sourceId}:seed${i}`,
      provenance: pick(['self_reported', 'club_recorded', 'league_verified']), dispute_status: 'none',
      metrics: hockey ? { goals: rand(4), assists: rand(4), shots: 1 + rand(9), pim: rand(6) } : { points: rand(35), rebounds: rand(15), assists: rand(12), minutes: 10 + rand(30) },
    });
  }
  for (let i = 0; i < rows.length; i += 100) {
    await retry('athlete_performances', () => admin.from('athlete_performances').insert(rows.slice(i, i + 100)));
  }
  console.log(`staging-seed: ${rows.length} performances`);
} else console.log(`staging-seed: performances present (${perfNow})`);

console.log(`staging-seed: done — subject ${subjectId} (${SUBJECT_EMAIL}, handle seedsubject)`);
