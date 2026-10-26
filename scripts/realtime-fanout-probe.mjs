#!/usr/bin/env node
/**
 * `node scripts/realtime-fanout-probe.mjs [--clients 10] [--writes 20] [--mode filtered|unfiltered] [--accounts 10]`
 *
 * The Realtime fan-out probe for scale fix 1 (docs/SCALE_AUDIT.md hole 1).
 * STAGING ONLY (refuses the production ref). N signed-in clients subscribe
 * to round A the way useSharedRound does — `--mode unfiltered` is the shape
 * before the fix (table-wide), `--mode filtered` the shape after
 * (`participant_id=in.(roster)`) — then the script writes K score updates on
 * round B (other people's round) and K on round A, and counts the change
 * events each client received. Before: every client hears B's writes;
 * after: none of them do, and all of them hear A's.
 *
 * Needs the staging seed (scripts/staging-seed.mjs): the clients sign in as
 * seed-0001…000N@staging.invalid with SEED_PASSWORD (.env.staging). The two
 * rounds are created and deleted by the script (service role).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const PROD_REF = 'htwhmdoiszhhmwuflgci';
const args = process.argv.slice(2);
const num = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : Number(args[i + 1]); };
const str = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : String(args[i + 1]); };
const CLIENTS = num('--clients', 10), WRITES = num('--writes', 20), MODE = str('--mode', 'filtered');
// Accounts are shared across clients (round-robin): GoTrue's sign-in endpoint
// is rate-limited per IP (~30 per 5 min), so 100 clients cannot each sign in
// from one laptop; a channel's delivery is per SUBSCRIPTION, not per user, so
// ten accounts over a hundred sockets measure the same fan-out.
const ACCOUNTS = Math.min(CLIENTS, num('--accounts', 10));
const env = {};
for (const file of ['.env.local', '.env.staging']) {
  try { for (const line of readFileSync(file, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } } catch { /* absent */ }
}
const url = env.NEXT_PUBLIC_SUPABASE_URL, anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = env.SUPABASE_SERVICE_ROLE_KEY, password = env.SEED_PASSWORD;
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url ?? '')?.[1];
if (!ref || ref === PROD_REF) { console.error(`fanout-probe: REFUSED — .env.local points at ${ref ?? 'nothing'}; staging only.`); process.exit(2); }
if (!password) { console.error('fanout-probe: SEED_PASSWORD missing — run scripts/staging-seed.mjs first.'); process.exit(2); }
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: subject } = await admin.from('profiles').select('id').eq('handle', 'seedsubject').single();
if (!subject) { console.error('fanout-probe: no seed subject — run the seed.'); process.exit(2); }
const { data: others } = await admin.from('profiles').select('id, email').like('email', 'seed-00%@staging.invalid').order('email').limit(8);
const players = (others ?? []).map(p => p.id);
if (players.length < 4) { console.error('fanout-probe: need ≥ 4 seed users.'); process.exit(2); }

async function makeRound(title, playerIds) {
  const { data: gp, error } = await admin.from('group_posts').insert({ creator_id: subject.id, type: 'golf_round', title, date: '2026-10-25', visibility: 'public', status: 'active' }).select('id').single();
  if (error) throw new Error('group_posts insert: ' + error.message);
  const { data: parts, error: e2 } = await admin.from('group_post_participants').insert(playerIds.map((pid, i) => ({ group_post_id: gp.id, profile_id: pid, status: 'confirmed', position: i + 1 }))).select('id');
  if (e2) throw new Error('participants insert: ' + e2.message);
  const { data: cards, error: e3 } = await admin.from('golf_participant_scores').insert(parts.map(p => ({ participant_id: p.id, total_score: 0, holes_completed: 0 }))).select('id, participant_id');
  if (e3) throw new Error('scores insert: ' + e3.message);
  return { id: gp.id, participantIds: parts.map(p => p.id), cardIds: cards.map(c => c.id) };
}
const roundA = await makeRound('Fanout probe A', players.slice(0, 2));
const roundB = await makeRound('Fanout probe B', players.slice(2, 4));
console.log(`fanout-probe: mode=${MODE} clients=${CLIENTS} writes=${WRITES} roundA=${roundA.id} roundB=${roundB.id}`);

const clients = [];
const counts = [];
try {
  const tokens = [];
  for (let a = 0; a < ACCOUNTS; a++) {
    const email = `seed-${String(a + 1).padStart(4, '0')}@staging.invalid`;
    const signer = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    let session = null;
    for (let attempt = 0; attempt < 4 && !session; attempt++) {
      const { data, error } = await signer.auth.signInWithPassword({ email, password });
      if (!error) session = data.session;
      else if (/rate limit/i.test(error.message)) { console.log(`fanout-probe: sign-in rate limited at account ${a + 1} — waiting 60 s`); await new Promise(r => setTimeout(r, 60_000)); }
      else throw new Error(`sign-in ${email}: ${error.message}`);
    }
    if (!session) throw new Error(`sign-in ${email}: still rate limited`);
    tokens.push(session.access_token);
  }
  console.log(`fanout-probe: ${tokens.length} accounts signed in for ${CLIENTS} clients`);
  for (let i = 0; i < CLIENTS; i++) {
    const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    c.realtime.setAuth(tokens[i % tokens.length]);
    const count = { a: 0, b: 0, other: 0 };
    counts.push(count);
    const listener = MODE === 'filtered'
      ? { event: '*', schema: 'public', table: 'golf_participant_scores', filter: `participant_id=in.(${roundA.participantIds.join(',')})` }
      : { event: '*', schema: 'public', table: 'golf_participant_scores' };
    const ch = c.channel(`shared-round:${roundA.id}:probe${i}`)
      .on('postgres_changes', listener, payload => {
        const pid = payload.new?.participant_id ?? payload.old?.participant_id;
        if (roundA.participantIds.includes(pid)) count.a++; else if (roundB.participantIds.includes(pid)) count.b++; else count.other++;
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_posts', filter: `id=eq.${roundA.id}` }, () => {});
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`client ${i} subscribe timeout`)), 15000);
      ch.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(t); resolve(); } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); reject(new Error(`client ${i} ${status}`)); } });
    });
    clients.push({ c, ch });
  }
  console.log(`fanout-probe: ${clients.length} clients subscribed`);
  await new Promise(r => setTimeout(r, 1500));

  const write = async (cardId, n) => { const { error } = await admin.from('golf_participant_scores').update({ total_score: n, holes_completed: Math.min(18, n) }).eq('id', cardId); if (error) throw new Error('write: ' + error.message); };
  const t0 = Date.now();
  for (let n = 1; n <= WRITES; n++) { await write(roundB.cardIds[n % roundB.cardIds.length], n); await new Promise(r => setTimeout(r, 60)); }
  for (let n = 1; n <= WRITES; n++) { await write(roundA.cardIds[n % roundA.cardIds.length], n); await new Promise(r => setTimeout(r, 60)); }
  await new Promise(r => setTimeout(r, 4000));
  const totalA = counts.reduce((s, c) => s + c.a, 0), totalB = counts.reduce((s, c) => s + c.b, 0), totalO = counts.reduce((s, c) => s + c.other, 0);
  console.log(`fanout-probe RESULT mode=${MODE}: ${WRITES} writes on round B → ${totalB} events delivered across ${CLIENTS} clients (per client: ${counts.map(c => c.b).join(',')}); ${WRITES} writes on round A → ${totalA} events (per client: ${counts.map(c => c.a).join(',')}); other ${totalO}; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  console.error('fanout-probe FAILED:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  for (const { c, ch } of clients) { try { await c.removeChannel(ch); } catch { /* */ } }
  await admin.from('golf_participant_scores').delete().in('id', [...roundA.cardIds, ...roundB.cardIds]);
  await admin.from('group_post_participants').delete().in('group_post_id', [roundA.id, roundB.id]);
  await admin.from('group_posts').delete().in('id', [roundA.id, roundB.id]);
  console.log('fanout-probe: rounds removed');
  process.exit(process.exitCode ?? 0);
}
