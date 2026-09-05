// ── Season rollover — the one-button clone-forward (phase 5.5, mig 165) ─────
// Masterplan §9: "clone forward, keep the structure, empty the rosters."
// What that means against THIS schema (verified):
//  * Teams PERSIST (145: "rollover re-enters the same row") — nothing
//    team-shaped is cloned; the same team rows are RE-ENTERED into the
//    new season's divisions via team_entries.
//  * Rosters empty by construction: registration lifecycle rows are
//    season-scoped; the new season starts with none and the old season's
//    rows remain the historical record (§8 invariant 2).
//  * The close-out act: stamp the old season archived_at (42703 pre-165
//    → skip silently, reported as archivedOld:false) and close its
//    still-open registration windows.
//  * COMPENSATED: any failure after the new season row exists deletes it
//    — divisions/programs/entries cascade, so the org never sees a
//    half-clone. Registration windows are NOT cloned (opening the new
//    window is the registrar's deliberate act — the checklist nags).
//  * Season-scoped staff-grant expiry belongs to the future staff-role
//    arc; nothing to expire today.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError, type RolloverInput } from '@/lib/structure/validate';
import type { OrgSide } from './authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ROLLOVER]';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

export interface NamedDivision {
  id: string;
  name: string;
}

/** Old→new division id mapping, keyed on name — unique per season by
 *  divisions_season_name_uniq, so the match is exact or absent. Pure. */
export function mapDivisionsByName(
  oldDivisions: NamedDivision[],
  newDivisions: NamedDivision[]
): Map<string, string> {
  const byName = new Map(newDivisions.map(d => [d.name, d.id]));
  const map = new Map<string, string>();
  for (const old of oldDivisions) {
    const newId = byName.get(old.name);
    if (newId) map.set(old.id, newId);
  }
  return map;
}

/** archived_at per season, best-effort: 42703 (pre-165) or any failure
 *  reads as "nothing archived" — the fail-open direction is correct here
 *  (archiving only ever REMOVES capabilities; its absence restores the
 *  pre-165 world, which was all-live). */
export async function seasonArchivedMap(
  admin: Admin,
  seasonIds: string[]
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (seasonIds.length === 0) return map;
  try {
    const { data, error } = await admin
      .from('seasons')
      .select('id, archived_at')
      .in('id', seasonIds);
    if (error) return map;
    for (const row of data ?? []) {
      map.set(row.id as string, row.archived_at !== null && row.archived_at !== undefined);
    }
  } catch {
    // fail open-as-live
  }
  return map;
}

export async function seasonRolloverPOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  input: RolloverInput,
  /** The manager performing the rollover — the staff-expiry trail's actor. */
  actorId: string | null = null
): Promise<NextResponse> {
  const col = orgColumn(side);

  const { data: oldSeason } = await admin
    .from('seasons')
    .select('id, label, sport_key')
    .eq('id', input.seasonId)
    .eq(col, orgId)
    .maybeSingle();
  if (!oldSeason) return NextResponse.json({ error: 'Season not found' }, { status: 404 });

  // The new season — org + sport inherited (the divisionCreatePOST rule).
  const { data: newSeason, error: seasonError } = await admin
    .from('seasons')
    .insert({
      [col]: orgId,
      label: input.label,
      starts_on: input.startsOn ?? null,
      ends_on: input.endsOn ?? null,
      sport_key: oldSeason.sport_key ?? null,
    })
    .select('id, label, starts_on, ends_on')
    .single();
  if (seasonError || !newSeason) {
    if (seasonError?.code === '23505') {
      return NextResponse.json(
        { error: 'A season with that label already exists' },
        { status: 409 }
      );
    }
    console.error(`${TAG} season insert error:`, seasonError);
    return NextResponse.json({ error: 'Failed to create the new season' }, { status: 500 });
  }

  // Everything past here compensates by deleting the new season (its
  // divisions/programs/entries cascade with it).
  const fail = async (context: string, error: unknown): Promise<NextResponse> => {
    console.error(`${TAG} ${context}:`, error);
    await admin.from('seasons').delete().eq('id', newSeason.id);
    return NextResponse.json({ error: 'Rollover failed — nothing was changed' }, { status: 500 });
  };

  // Clone divisions (one homogeneous batch).
  const { data: oldDivisions, error: oldDivError } = await admin
    .from('divisions')
    .select('id, sport_key, name, age_band, gender_stream, tier, capacity_estimate')
    .eq('season_id', oldSeason.id)
    .limit(300);
  if (oldDivError) return fail('old divisions read', oldDivError);
  let divisionMap = new Map<string, string>();
  if ((oldDivisions ?? []).length > 0) {
    const { data: newDivisions, error: divError } = await admin
      .from('divisions')
      .insert(
        (oldDivisions ?? []).map(d => ({
          [col]: orgId,
          season_id: newSeason.id,
          sport_key: d.sport_key,
          name: d.name,
          age_band: d.age_band,
          gender_stream: d.gender_stream,
          tier: d.tier,
          capacity_estimate: d.capacity_estimate,
        }))
      )
      .select('id, name');
    if (divError || !newDivisions) return fail('division clone', divError);
    divisionMap = mapDivisionsByName(
      (oldDivisions ?? []) as NamedDivision[],
      newDivisions as NamedDivision[]
    );
  }

  // Clone programs — best-effort (pre-162 table missing → skip).
  let programsCloned = 0;
  const { data: oldPrograms, error: progReadError } = await admin
    .from('programs')
    .select('sport_key, type, name, capacity_estimate')
    .eq('season_id', oldSeason.id)
    .limit(300);
  if (!progReadError && (oldPrograms ?? []).length > 0) {
    const { error: progError, data: newPrograms } = await admin
      .from('programs')
      .insert(
        (oldPrograms ?? []).map(p => ({
          season_id: newSeason.id,
          sport_key: p.sport_key,
          type: p.type,
          name: p.name,
          capacity_estimate: p.capacity_estimate,
        }))
      )
      .select('id');
    if (progError) return fail('program clone', progError);
    programsCloned = (newPrograms ?? []).length;
  } else if (progReadError && !isMissingTableError(progReadError.code)) {
    return fail('program read', progReadError);
  }

  // Re-enter the SAME teams into the mapped new divisions — skipping
  // archived teams (they sat out; unarchiving re-enters manually).
  let entriesCloned = 0;
  if (divisionMap.size > 0) {
    const { data: oldEntries, error: entriesError } = await admin
      .from('team_entries')
      .select('team_id, division_id, team:team_id (status)')
      .in('division_id', [...divisionMap.keys()])
      .limit(1000);
    if (entriesError) return fail('old entries read', entriesError);
    const rows = (oldEntries ?? [])
      .filter(e => {
        const team = Array.isArray(e.team) ? e.team[0] : e.team;
        return (team as { status?: string } | null)?.status !== 'archived';
      })
      .map(e => ({
        team_id: e.team_id as string,
        division_id: divisionMap.get(e.division_id as string)!,
      }))
      .filter(r => !!r.division_id);
    if (rows.length > 0) {
      const { error: entryError, data: inserted } = await admin
        .from('team_entries')
        .upsert(rows, { onConflict: 'team_id,division_id', ignoreDuplicates: true })
        .select('id');
      if (entryError) return fail('entry clone', entryError);
      entriesCloned = (inserted ?? []).length;
    }
  }

  // The close-out act — both best-effort: the clone already succeeded.
  let archivedOld = false;
  const { error: archiveError } = await admin
    .from('seasons')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', oldSeason.id);
  if (!archiveError) archivedOld = true;
  else if (archiveError.code !== '42703') {
    console.error(`${TAG} archive stamp error:`, archiveError);
  }
  const { error: windowError } = await admin
    .from('registration_windows')
    .update({ closes_at: new Date().toISOString() })
    .eq('season_id', oldSeason.id)
    .is('closes_at', null);
  if (windowError && !isMissingTableError(windowError.code)) {
    console.error(`${TAG} window close error:`, windowError);
  }
  // Org staff program (178): season-pinned staff grants expire at rollover
  // (masterplan §5) — stamp expires_at on the old season's live staff rows
  // and write the trail. Best-effort, 42703-safe (pre-178 columns).
  const staffExpired = await expireSeasonStaff(admin, side, orgId, oldSeason.id, actorId);

  return NextResponse.json({
    season: newSeason,
    cloned: {
      divisions: divisionMap.size,
      programs: programsCloned,
      teamEntries: entriesCloned,
    },
    archivedOld,
    staffExpired,
  });
}

/** Expire the live staff grants pinned to a season (rollover). Returns the
 *  number expired; 0 on a pre-178 database or any failure — the rollover
 *  itself already succeeded, and an un-expired grant is inert once the
 *  season is archived only in the sense that its scope is history; the
 *  console shows it until the next rollover pass, which is acceptable. */
export async function expireSeasonStaff(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  seasonId: string,
  actorId: string | null
): Promise<number> {
  const col = orgColumn(side);
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('memberships')
    .update({ expires_at: now })
    .eq(col, orgId)
    .eq('kind', 'staff')
    .eq('season_id', seasonId)
    .or(`expires_at.is.null,expires_at.gt.${now}`) // hardening-ok: server clock, no user input
    .select('id, profile_id, role, scope_type, scope_id, sections');
  if (error) {
    if (error.code !== '42703') console.error(`${TAG} staff expiry error:`, error);
    return 0;
  }
  const rows = data ?? [];
  if (rows.length === 0) return 0;
  const { error: auditError } = await admin.from('org_staff_audit').insert(
    rows.map(r => ({
      [col]: orgId,
      profile_id: r.profile_id,
      actor_id: actorId,
      action: 'expired',
      role: r.role,
      scope_type: r.scope_type,
      scope_id: r.scope_id,
      season_id: seasonId,
      old_sections: r.sections,
    }))
  );
  if (auditError) console.error(`${TAG} staff expiry audit error:`, auditError);
  return rows.length;
}
