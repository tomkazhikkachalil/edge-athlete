import { expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';

// Round 5 D0-e (Sep 2026): the ONE way a spec mints an org. Writes
// `organizations` directly — the row every reader keys on since 231 — with
// the kind set; the mirror still creates the leagues / clubs twin until 235,
// after which `leagues` / `clubs` are views that refuse an INSERT (a spec
// that still inserts through an old name fails loudly, by decision). A
// league needs a sport_key (234's CHECK; 233's mirror refused it before).
//
// Returns `{ id }` only: sixty-one sites read nothing else, and the raw row
// would carry `sport_key` where a clubs row carried `primary_sport`.

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

export async function createQaOrg(admin: SupabaseClient, kind: QaOrgKind, fields: QaOrgFields): Promise<{ id: string }> {
  if (kind === 'league' && !fields.sport_key) throw new Error('createQaOrg: a league needs a sport_key');
  // The sides' capability defaults (mig 142) — organizations' are false / false.
  const row = {
    kind,
    operates_competitions: kind === 'league',
    operates_teams: kind === 'club',
    ...fields,
  };
  const { data, error } = await admin.from('organizations').insert(row).select('id').single();
  expect(error, error?.message).toBeNull();
  return { id: data!.id as string };
}
