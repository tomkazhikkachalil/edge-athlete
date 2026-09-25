#!/usr/bin/env node
// ── The bulk QA sweep for STAGING (Sep 24 2026) ──────────────────────────────
// The e2e suite's global setup sweeps what a killed run left behind, one row
// at a time through the same rules; this is the shovel for the day a crashed
// staging holds a thousand QA orgs (Sep 24: 1 021 orgs, 60 users, 38 stubs).
// Same three classes, same rules as e2e/helpers/qa-sweep-rules.ts — the org
// name regex here is that module's SQL twin and a unit test pins the two
// equal — and the same order: orgs first (their cascades take the bulk), then
// the shadow users no live holder protects, then the QA users.
//
//   node scripts/staging-sweep.mjs            # dry run — prints the counts
//   node scripts/staging-sweep.mjs --apply    # deletes, 200 orgs per statement
//
// Runs through the management API (.env.staging) like staging-sql.mjs and
// REFUSES the production ref. Every batch is one transaction.

import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const PROD_REF = 'htwhmdoiszhhmwuflgci';
const QA_ORG_NAME_SQL = '^QA .* [0-9]{13}$';
const CUTOFF_SQL = "now() - interval '24 hours'";

function env(name) {
  const line = readFileSync('.env.staging', 'utf8').split('\n').find(l => l.startsWith(`${name}=`));
  if (!line) throw new Error(`staging-sweep: ${name} missing from .env.staging`);
  return line.slice(name.length + 1).trim();
}
const token = env('SUPABASE_ACCESS_TOKEN');
const ref = env('STAGING_PROJECT_REF');
if (ref === PROD_REF) { console.error('staging-sweep: refusing the production project'); process.exit(2); }

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`staging-sweep: ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// The stale QA users (the auth listing is the source of truth for e2e; here the profiles' emails are).
const STALE_USERS = `SELECT id FROM public.profiles WHERE email ~ '^edgeqa-[a-z0-9]+@example\\.com$' AND created_at <= ${CUTOFF_SQL}`;
const STALE_ORGS = `SELECT id FROM public.organizations WHERE name ~ '${QA_ORG_NAME_SQL}' AND created_at <= ${CUTOFF_SQL} AND (owner_profile_id IS NULL OR owner_profile_id IN (${STALE_USERS}))`;
// A shadow is swept when no access row is held by a live holder: one that is not a stale QA user, not a shadow itself, not the profile's own row.
const STALE_SHADOWS = `SELECT p.id FROM public.profiles p WHERE p.email ~ '@(stubs|minors)\\.invalid$' AND p.created_at <= ${CUTOFF_SQL}
  AND NOT EXISTS (SELECT 1 FROM public.profile_access a WHERE a.profile_id = p.id AND a.user_id <> p.id
    AND a.user_id NOT IN (${STALE_USERS}) AND a.user_id NOT IN (SELECT id FROM public.profiles WHERE email ~ '@(stubs|minors)\\.invalid$'))`;

// Departed tombstones (238): a purged QA user kept as a name-only row — no
// auth user, email <id>@departed.invalid, the QA name (the org rule's shape).
const DEPARTED_EMAIL_LIKE = '%@departed.invalid';
const STALE_TOMBSTONES = `SELECT id FROM public.profiles WHERE email LIKE '${DEPARTED_EMAIL_LIKE}' AND full_name ~ '${QA_ORG_NAME_SQL}' AND departed_at <= ${CUTOFF_SQL}`;

const counts = await sql(`SELECT (SELECT count(*) FROM (${STALE_ORGS}) o) AS orgs, (SELECT count(*) FROM (${STALE_SHADOWS}) s) AS shadows, (SELECT count(*) FROM (${STALE_USERS}) u) AS users, (SELECT count(*) FROM (${STALE_TOMBSTONES}) t) AS tombstones`);
const { orgs, shadows, users, tombstones } = counts[0];
console.log(`staging-sweep: stale QA orgs ${orgs} · shadow users ${shadows} · QA users ${users} · tombstones ${tombstones}${APPLY ? '' : ' (dry run — pass --apply to delete)'}`);
if (!APPLY) process.exit(0);

// 1. orgs, 200 per statement — the cascades take sites, competitions, entries, results, memberships
let left = Number(orgs);
while (left > 0) {
  const r = await sql(`DELETE FROM public.organizations WHERE id IN (${STALE_ORGS} ORDER BY created_at LIMIT 200); SELECT count(*) AS n FROM (${STALE_ORGS}) o`);
  left = Number(r[0].n); console.log(`staging-sweep: orgs left ${left}`);
}
// 2. the profiles — shadows first (the minors' access rows go with their profile; the guard only checks a profile that still exists), then the users.
// The two cascade quirks the hand sweep met: pre-delete the SET-NULL children whose parent participant is going in the same cascade.
const PROFILE_SWEEP = (who) => `
  CREATE TEMP TABLE sweep_p ON COMMIT DROP AS ${who};
  DELETE FROM public.contest_results r USING public.contest_participants cp JOIN public.competition_entries e ON e.id = cp.entry_id WHERE r.participant_id = cp.id AND e.profile_id IN (SELECT id FROM sweep_p);
  UPDATE public.contest_results SET entered_by = NULL WHERE entered_by IN (SELECT id FROM sweep_p);
  UPDATE public.contest_results SET confirmed_by = NULL WHERE confirmed_by IN (SELECT id FROM sweep_p);
  UPDATE public.contest_results SET disputed_by = NULL WHERE disputed_by IN (SELECT id FROM sweep_p);
  DELETE FROM public.golf_participant_scores gs USING public.group_post_participants gp WHERE gs.participant_id = gp.id AND gp.profile_id IN (SELECT id FROM sweep_p);
  DELETE FROM public.group_post_participants WHERE profile_id IN (SELECT id FROM sweep_p);
  DELETE FROM public.athlete_performances WHERE profile_id IN (SELECT id FROM sweep_p);
  DELETE FROM public.profiles WHERE id IN (SELECT id FROM sweep_p);
  DELETE FROM auth.users WHERE id IN (SELECT id FROM sweep_p);
  SELECT count(*) AS n FROM sweep_p;`;
const s = await sql(PROFILE_SWEEP(STALE_SHADOWS)); console.log(`staging-sweep: shadow users deleted ${s[0].n}`);
const u = await sql(PROFILE_SWEEP(STALE_USERS)); console.log(`staging-sweep: QA users deleted ${u[0].n}`);
const t = await sql(PROFILE_SWEEP(STALE_TOMBSTONES)); console.log(`staging-sweep: QA tombstones deleted ${t[0].n}`);
console.log('staging-sweep: done.');
