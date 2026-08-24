// ── Club creation — the ONE place a club and its owner row are born ─────────
// Mirror of src/lib/leagues/create.ts (deliberately NOT generalized into a
// createOrgWithOwner: table names, sport_key presence and rollback targets
// differ, and two explicit functions beat one generic one). Two inserts, no
// transaction over PostgREST — a failed owner-member insert deletes the
// fresh club by hand so an owner-less club is never CREATED this way (the
// 001 demo rows are the grandfathered exception, reassignable later).

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the notify.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface ClubRow {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface CreateClubInput {
  name: string;
  description: string | null;
  ownerProfileId: string;
  /** Pre-built location columns: placeToClubColumns(place), or a
   *  club_requests row's nine columns verbatim on the approval path. */
  placeColumns: Record<string, string | number | null>;
}

export type CreateClubResult =
  | { club: ClubRow }
  | { error: 'insert_failed' | 'member_failed' };

export async function createClubWithOwner(
  admin: Admin,
  input: CreateClubInput
): Promise<CreateClubResult> {
  const { data: club, error: insertError } = await admin
    .from('clubs')
    .insert({
      name: input.name,
      description: input.description,
      owner_profile_id: input.ownerProfileId,
      ...input.placeColumns,
    })
    .select()
    .single();
  if (insertError || !club) {
    console.error('[CLUBS CREATE] insert error:', insertError);
    return { error: 'insert_failed' };
  }

  const { error: memberError } = await admin
    .from('club_members')
    .insert({ club_id: club.id, profile_id: input.ownerProfileId, role: 'owner' });
  if (memberError) {
    console.error('[CLUBS CREATE] owner member insert error:', memberError);
    // The rollback delete also fires the 112 doc-delete trigger — search
    // stays convergent for free.
    await admin.from('clubs').delete().eq('id', club.id);
    return { error: 'member_failed' };
  }

  return { club: club as ClubRow };
}
