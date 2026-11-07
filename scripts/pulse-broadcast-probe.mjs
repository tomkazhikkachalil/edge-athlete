#!/usr/bin/env node
/**
 * pulse-broadcast-probe — proves migration 301's change signals end to end
 * on STAGING (the cost program PR C, Nov 6 2026; docs/specs/pulse.md): a
 * browser-style client signs in as a seed user, joins its PRIVATE topic
 * (`user:{id}`, authorized by the realtime.messages policy) and the
 * `live-now` topic (private too since 304 — a client-side send on it must
 * be refused, which this probe also checks), then the service role performs the writes the triggers
 * watch — a message to the user, a read, a golf round going live, the user
 * added to its roster, the round deleted — and the script counts what the
 * client heard. Cleans up its rows. Refuses production.
 *
 *   node scripts/pulse-broadcast-probe.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from
 * .env.local and SEED_PASSWORD from .env.staging (the seed users
 * seed-0001…@staging.invalid — scripts/staging-seed.mjs). Exit 0 = every
 * expected signal arrived; 1 = something was missed (the counts are printed).
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const PROD_REF = 'htwhmdoiszhhmwuflgci';
const env = {};
for (const file of ['.env.local', '.env.staging']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* absent */ }
}
const url = env.NEXT_PUBLIC_SUPABASE_URL, anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = env.SUPABASE_SERVICE_ROLE_KEY, password = env.SEED_PASSWORD;
const ref = url ? new URL(url).host.split('.')[0] : null;
if (!ref || ref === PROD_REF) { console.error(`pulse-probe: REFUSED — .env.local points at ${ref ?? 'nothing'}; staging only.`); process.exit(2); }
if (!anon || !service || !password) { console.error('pulse-probe: NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and SEED_PASSWORD are required.'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: seeds, error: seedErr } = await admin.from('profiles').select('id, email').like('email', 'seed-00%@staging.invalid').order('email').limit(2);
if (seedErr || !seeds || seeds.length < 2) { console.error('pulse-probe: two seed users are needed —', seedErr?.message ?? 'run scripts/staging-seed.mjs'); process.exit(2); }
const [a, b] = seeds;

// The listener: a browser-style client as A.
const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: signIn, error: signErr } = await client.auth.signInWithPassword({ email: a.email, password });
if (signErr || !signIn.session) { console.error('pulse-probe: sign-in failed —', signErr?.message); process.exit(2); }
await client.realtime.setAuth(signIn.session.access_token);

const heard = { user: [], live: [], other: [] };

// A second listener as B on live-now: the one who would hear a forged signal.
const other = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: signInB, error: signErrB } = await other.auth.signInWithPassword({ email: b.email, password });
if (signErrB || !signInB.session) { console.error('pulse-probe: sign-in as B failed —', signErrB?.message); process.exit(2); }
await other.realtime.setAuth(signInB.session.access_token);
let stateOther = 'joining';
const otherChannel = other
  .channel('live-now', { config: { private: true } })
  .on('broadcast', { event: 'pulse' }, m => heard.other.push(m.payload))
  .subscribe(s => { stateOther = s; });
const states = { user: 'joining', live: 'joining' };
const userChannel = client
  .channel(`user:${a.id}`, { config: { private: true } })
  .on('broadcast', { event: 'pulse' }, m => heard.user.push(m.payload))
  .subscribe(s => { states.user = s; });
const liveChannel = client
  .channel('live-now', { config: { private: true } })
  .on('broadcast', { event: 'pulse' }, m => heard.live.push(m.payload))
  .subscribe(s => { states.live = s; });
for (let i = 0; i < 100 && !(states.user === 'SUBSCRIBED' && states.live === 'SUBSCRIBED' && stateOther === 'SUBSCRIBED'); i++) await sleep(100);
console.log(`channels: user:${a.id.slice(0, 8)} ${states.user} · live-now ${states.live}`);
if (states.user !== 'SUBSCRIBED' || states.live !== 'SUBSCRIBED') { console.error('pulse-probe: a channel did not join (is the realtime.messages policy there? 301)'); process.exit(1); }

const stamp = Date.now();
let conversationId = null, roundId = null;
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) fail.push(name); };
const countUser = kind => heard.user.filter(p => p.kind === kind).length;
try {
  // 1. A message from B in a conversation with A → A's private topic, kind 'messages'.
  const { data: conv, error: convErr } = await admin.from('conversations').insert({ type: 'direct', created_by: b.id }).select('id').single();
  if (convErr) throw convErr;
  conversationId = conv.id;
  const { error: partErr } = await admin.from('conversation_participants').insert([{ conversation_id: conversationId, profile_id: a.id }, { conversation_id: conversationId, profile_id: b.id }]);
  if (partErr) throw partErr;
  // 0. A forged signal from a client (304): no INSERT policy on realtime.messages, so a private-channel send is refused — the other client hears nothing.
  const forged = await liveChannel.send({ type: 'broadcast', event: 'pulse', payload: { kind: 'forged', at: stamp } }).catch(e => `threw: ${e?.message ?? e}`);
  await sleep(2000);
  expect(`a forged live-now send from A (send → ${forged}) reaches nobody`, !heard.other.some(p => p.kind === 'forged') && !heard.live.some(p => p.kind === 'forged'));
  const before = countUser('messages');
  const { error: msgErr } = await admin.from('messages').insert({ conversation_id: conversationId, sender_id: b.id, type: 'text', content: `pulse probe ${stamp}` });
  if (msgErr) throw msgErr;
  await sleep(2500);
  expect('a message reaches the recipient\'s private topic', countUser('messages') === before + 1);

  // 2. A reads → her private topic again.
  const { error: readErr } = await admin.from('conversation_participants').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('profile_id', a.id);
  if (readErr) throw readErr;
  await sleep(2500);
  expect('a read reaches the reader\'s private topic', countUser('messages') === before + 2);

  // 3. B's golf round goes live → the public topic, kind 'golf'.
  const liveBefore = heard.live.length;
  const { data: round, error: roundErr } = await admin.from('group_posts').insert({ creator_id: b.id, type: 'golf_round', title: `pulse probe ${stamp}`, date: new Date().toISOString().slice(0, 10), visibility: 'private', status: 'pending' }).select('id').single();
  if (roundErr) throw roundErr;
  roundId = round.id;
  await sleep(2500);
  expect('a round going live reaches the live-now topic', heard.live.length === liveBefore + 1 && heard.live[heard.live.length - 1]?.kind === 'golf');

  // 4. A is added to the live round's roster → her private topic, kind 'live'.
  const { error: rosterErr } = await admin.from('group_post_participants').insert({ group_post_id: roundId, profile_id: a.id, status: 'pending', role: 'participant' });
  if (rosterErr) throw rosterErr;
  await sleep(2500);
  expect('a seat on a live private round reaches that person\'s private topic', countUser('live') === 1);

  // 5. The round is deleted → the public topic again; B's own seat never reached A.
  const { error: delErr } = await admin.from('group_posts').delete().eq('id', roundId);
  if (delErr) throw delErr;
  roundId = null;
  await sleep(2500);
  expect('a live round deleted reaches the live-now topic', heard.live.length === liveBefore + 2);
  expect('nothing else reached the private topic', heard.user.length === 3);
  expect('every payload carries at and a kind, nothing personal', [...heard.user, ...heard.live].every(p => typeof p.at === 'number' && typeof p.kind === 'string' && !('content' in p) && !('profile_id' in p)));
} catch (err) {
  console.error('pulse-probe: a write failed —', err.message ?? err);
  fail.push('write');
} finally {
  if (roundId) await admin.from('group_posts').delete().eq('id', roundId);
  if (conversationId) await admin.from('conversations').delete().eq('id', conversationId);
  await userChannel.unsubscribe();
  await liveChannel.unsubscribe();
  await otherChannel.unsubscribe();
  await client.auth.signOut();
  await other.auth.signOut();
}
expect('the genuine live-now signals reached B too', heard.other.filter(p => p.kind === 'golf').length >= 2);
console.log(`heard: private ${heard.user.length} (${heard.user.map(p => p.kind).join(', ')}) · live-now A ${heard.live.length} (${heard.live.map(p => p.kind).join(', ')}) · live-now B ${heard.other.length} (${heard.other.map(p => p.kind).join(', ')})`);
console.log(fail.length === 0 ? 'pulse-probe: every signal arrived' : `pulse-probe: MISSED ${fail.join('; ')}`);
process.exit(fail.length === 0 ? 0 : 1);
