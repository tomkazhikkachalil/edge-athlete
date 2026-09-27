import { expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';

// Round 5 D0-e (Sep 2026): the ONE way a spec mints an org. Writes
// `organizations` directly — the row every reader keys on since 231 — with
// the kind set; since 235 `leagues` / `clubs` are views that refuse an
// INSERT (a spec that still inserts through an old name fails loudly, by
// decision). A league needs a sport_key (234's CHECK).
//
// Returns `{ id }` only: the sites read nothing else, and the raw row would
// carry `sport_key` where a clubs row carried `primary_sport`.
//
// Teardown hardening (Sep 24 2026): every id minted here is REMEMBERED for
// the run (in a file — see below). Specs delete their own orgs in a `finally` through `deleteQaOrgs`
// (error-checked — the old raw deletes through the views never were); the
// global teardown deletes whatever is still recorded, so an org a killed
// spec never reached does not outlive the run. `organizations.owner_profile_id`
// is SET NULL, so deleting the QA user would never have taken it.

export type QaOrgKind = 'league' | 'club';

export interface QaOrgFields {
  name: string;
  /** Null for an unclaimed org (the claim spec). */
  owner_profile_id?: string | null;
  /** A league's sport (required); a club's primary sport (optional). */
  sport_key?: string | null;
  visibility?: 'public' | 'private';
  join_policy?: 'open' | 'approval';
  listing_status?: 'unlisted' | 'pending' | 'listed';
  approved_at?: string | null;
  operates_competitions?: boolean;
  operates_teams?: boolean;
  description?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  location?: string | null;
}

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// The run's org registry lives in a FILE, not a module variable: specs run in
// Playwright WORKER processes and the global teardown in the main process, so
// an in-memory set is always empty where it is read. One line per minted id
// (`workers: 1` — no contention); a delete rewrites the file without the id.
const REGISTRY = join(process.cwd(), 'e2e', '.auth', 'orgs.txt');

/** Every org this run minted and has not yet deleted — the teardown's list. */
export function createdQaOrgIds(): Set<string> {
  if (!existsSync(REGISTRY)) return new Set();
  return new Set(readFileSync(REGISTRY, 'utf8').split('\n').map(l => l.trim()).filter(Boolean));
}
function recordQaOrg(id: string): void {
  mkdirSync(join(process.cwd(), 'e2e', '.auth'), { recursive: true });
  appendFileSync(REGISTRY, `${id}\n`);
}
function forgetQaOrgs(ids: readonly string[]): void {
  if (!existsSync(REGISTRY)) return;
  const gone = new Set(ids);
  writeFileSync(REGISTRY, [...createdQaOrgIds()].filter(id => !gone.has(id)).map(id => `${id}\n`).join(''));
}

export async function createQaOrg(admin: SupabaseClient, kind: QaOrgKind, fields: QaOrgFields): Promise<{ id: string }> {
  if (kind === 'league' && !fields.sport_key) throw new Error('createQaOrg: a league needs a sport_key');
  // Both switches ON (teams & divisions, 242 — they gate the console, the org
  // page and the site now): a fixture org shows everything; a spec that
  // tests the gating passes the switch it turns off in `fields`.
  const row = {
    kind,
    operates_competitions: true,
    operates_teams: true,
    ...fields,
  };
  const { data, error } = await admin.from('organizations').insert(row).select('id').single();
  expect(error, error?.message).toBeNull();
  const id = data!.id as string;
  recordQaOrg(id);
  return { id };
}

/** A LIVE season of this org for a team roster fixture — migration 242's
 *  CHECK: every team roster row names its season. The newest live season,
 *  else a fresh one (its label unique per org). The spec's org teardown
 *  cascades it. */
export async function rosterSeasonId(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data: live } = await admin.from('seasons').select('id').eq('org_id', orgId).is('archived_at', null).order('created_at', { ascending: false }).limit(1);
  if (live && live.length > 0) return live[0].id as string;
  const { data, error } = await admin.from('seasons').insert({ org_id: orgId, label: `QA roster ${Date.now()}` }).select('id').single();
  expect(error, error?.message).toBeNull();
  return data!.id as string;
}

/** Delete orgs by id through the one table (the cascades take memberships,
 *  competitions, entries, results, sites, staff rows, affiliations). Error-
 *  checked and idempotent: an id already gone is fine (a spec's `finally` and
 *  the global teardown may both name it); a refused delete throws. Returns the
 *  number of rows that were actually removed. */
export async function deleteQaOrgs(admin: SupabaseClient, ids: ReadonlyArray<string | null | undefined>): Promise<number> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (wanted.length === 0) return 0;
  const { data, error } = await admin.from('organizations').delete().in('id', wanted).select('id');
  if (error) throw new Error(`deleteQaOrgs(${wanted.join(', ')}) failed: ${error.message}`);
  forgetQaOrgs(wanted);
  return (data ?? []).length;
}
