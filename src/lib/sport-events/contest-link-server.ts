/**
 * An org-hosted event counting toward a competition — the I/O half
 * (Events program, phase 2b, B1; migration 211). The ONE writer of
 * `contests.sport_event_round_id`. Every read is 42703-tolerant: before
 * 211 ran the link simply does not exist (`readCountsToward` → null) and
 * the golf-sync guard reads null.
 *
 *   mintContestsForEvent   one contest per non-cancelled round, idempotent
 *                          on the partial UNIQUE; the accepted playing
 *                          participants get an approved competition_entries
 *                          row (the organizer's authority is
 *                          manage_competitions — entryAddPOST's roster rule
 *                          is NOT re-applied: the event's field is theirs)
 *                          and a contest_participants row
 *   unlinkContestsForEvent draft / open only; refused once any result exists;
 *                          a published mirror event is deleted with it
 *   readCountsToward       round id → {contestId, competitionId, name}
 *   readSportEventRoundLink the guard the golf-sync engine asks
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mirrorContestDelete } from '@/lib/competitions/calendar-mirror';
import { contestRowFor, type CompetitionForLink } from './contest-link';
import type { SportEventRoundRow, SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const missingColumn = (e: { code?: string } | null | undefined) => e?.code === '42703' || e?.code === 'PGRST204';

export interface CountsToward {
  contestId: string;
  competitionId: string;
  competitionName: string;
}

/** Round id → its contest, for the rounds that have one. `null` = pre-211 (the column does not exist). */
export async function readCountsToward(admin: Admin, roundIds: string[]): Promise<Map<string, CountsToward> | null> {
  if (roundIds.length === 0) return new Map();
  const { data, error } = await admin
    .from('contests')
    .select('id, sport_event_round_id, competition:competition_id (id, name)')
    .in('sport_event_round_id', roundIds);
  if (error) {
    if (missingColumn(error)) return null;
    console.error('[contest-link] counts-toward read failed:', error);
    return new Map();
  }
  const out = new Map<string, CountsToward>();
  for (const row of (data ?? []) as Array<{ id: string; sport_event_round_id: string; competition: { id: string; name: string } | Array<{ id: string; name: string }> | null }>) {
    const c = Array.isArray(row.competition) ? row.competition[0] : row.competition;
    if (!c) continue;
    out.set(row.sport_event_round_id, { contestId: row.id, competitionId: c.id, competitionName: c.name });
  }
  return out;
}

/** The golf-sync engine's question: is this contest an event round's? (null pre-211 or unlinked.) */
export async function readSportEventRoundLink(admin: Admin, contestId: string): Promise<string | null> {
  const { data, error } = await admin.from('contests').select('sport_event_round_id').eq('id', contestId).maybeSingle();
  if (error || !data) return null;
  return (data as { sport_event_round_id: string | null }).sport_event_round_id ?? null;
}

export async function readCompetitionForLink(admin: Admin, competitionId: string): Promise<CompetitionForLink | null> {
  const { data } = await admin.from('competitions').select('id, name, club_id, league_id, sport_key, format, entrant_type, status').eq('id', competitionId).maybeSingle();
  return (data as CompetitionForLink | null) ?? null;
}

/** The org's venue on the round's course, when one exists (best-effort). */
async function venueFor(admin: Admin, event: SportEventRow, courseId: string | null): Promise<string | null> {
  if (!courseId) return null;
  let q = admin.from('venues').select('id').eq('golf_course_id', courseId).limit(1);
  q = event.club_id ? q.eq('club_id', event.club_id) : q.eq('league_id', event.league_id as string);
  const { data } = await q.maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** The accepted playing participants' approved entries on the competition (created when missing), profile → entry id. */
export async function ensureEntries(admin: Admin, competitionId: string, profileIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (profileIds.length === 0) return out;
  const { data: existing } = await admin.from('competition_entries').select('id, profile_id, status').eq('competition_id', competitionId).in('profile_id', profileIds);
  for (const e of (existing ?? []) as Array<{ id: string; profile_id: string; status: string }>) {
    if (e.status !== 'approved') await admin.from('competition_entries').update({ status: 'approved' }).eq('id', e.id);
    out.set(e.profile_id, e.id);
  }
  const missing = profileIds.filter(p => !out.has(p));
  if (missing.length > 0) {
    const { data: created } = await admin.from('competition_entries').insert(missing.map(profile_id => ({ competition_id: competitionId, profile_id, team_id: null, status: 'approved' }))).select('id, profile_id');
    for (const e of (created ?? []) as Array<{ id: string; profile_id: string }>) out.set(e.profile_id, e.id);
  }
  return out;
}

export interface MintOutcome {
  ok: boolean;
  /** Round id → contest id, every non-cancelled round after the call. */
  contests: Map<string, string>;
  reason?: 'needs_migration' | 'insert';
}

export async function mintContestsForEvent(admin: Admin, event: SportEventRow, rounds: SportEventRoundRow[], competitionId: string): Promise<MintOutcome> {
  const active = rounds.filter(r => r.status !== 'cancelled').sort((a, b) => a.sequence - b.sequence);
  const existing = await readCountsToward(admin, active.map(r => r.id));
  if (existing === null) return { ok: false, contests: new Map(), reason: 'needs_migration' };
  const contests = new Map<string, string>([...existing.entries()].map(([rid, c]) => [rid, c.contestId]));

  const { data: parts } = await admin.from('sport_event_participants').select('profile_id').eq('sport_event_id', event.id).eq('status', 'accepted').eq('playing', true);
  const profileIds = ((parts ?? []) as Array<{ profile_id: string }>).map(p => p.profile_id);
  const entryOf = await ensureEntries(admin, competitionId, profileIds);

  for (const round of active) {
    if (contests.has(round.id)) continue;
    const venueId = await venueFor(admin, event, round.course_id);
    const { data: contest, error } = await admin.from('contests').insert(contestRowFor(round, competitionId, venueId)).select('id').single();
    if (error || !contest) {
      if (missingColumn(error)) return { ok: false, contests, reason: 'needs_migration' };
      if (error?.code === '23505') {
        // Lost a mint race on the partial UNIQUE: the row exists now.
        const again = await readCountsToward(admin, [round.id]);
        const c = again?.get(round.id);
        if (c) { contests.set(round.id, c.contestId); continue; }
      }
      console.error('[contest-link] contest insert failed:', error);
      return { ok: false, contests, reason: 'insert' };
    }
    const contestId = (contest as { id: string }).id;
    if (entryOf.size > 0) {
      await admin.from('contest_participants').insert([...entryOf.values()].map(entry_id => ({ contest_id: contestId, entry_id, side: null })));
    }
    contests.set(round.id, contestId);
  }
  return { ok: true, contests };
}

/** Add a participant to every linked contest of the event (a late joiner, PR 9's completion pass). Idempotent. */
export async function ensureContestParticipants(admin: Admin, competitionId: string, contestIds: string[], profileIds: string[]): Promise<void> {
  if (contestIds.length === 0 || profileIds.length === 0) return;
  const entryOf = await ensureEntries(admin, competitionId, profileIds);
  const { data: have } = await admin.from('contest_participants').select('contest_id, entry_id').in('contest_id', contestIds);
  const present = new Set(((have ?? []) as Array<{ contest_id: string; entry_id: string }>).map(h => `${h.contest_id}:${h.entry_id}`));
  const rows: Array<{ contest_id: string; entry_id: string; side: null }> = [];
  for (const contestId of contestIds) for (const entryId of entryOf.values()) if (!present.has(`${contestId}:${entryId}`)) rows.push({ contest_id: contestId, entry_id: entryId, side: null });
  if (rows.length > 0) await admin.from('contest_participants').insert(rows);
}

export type UnlinkOutcome = { ok: true; removed: number } | { ok: false; reason: 'results_exist' | 'needs_migration' };

export async function unlinkContestsForEvent(admin: Admin, roundIds: string[]): Promise<UnlinkOutcome> {
  const linked = await readCountsToward(admin, roundIds);
  if (linked === null) return { ok: false, reason: 'needs_migration' };
  const contestIds = [...linked.values()].map(c => c.contestId);
  if (contestIds.length === 0) return { ok: true, removed: 0 };
  const { count } = await admin.from('contest_results').select('id', { count: 'exact', head: true }).in('contest_id', contestIds);
  if ((count ?? 0) > 0) return { ok: false, reason: 'results_exist' };
  const { data: rows } = await admin.from('contests').select('id, event_id').in('id', contestIds);
  for (const r of (rows ?? []) as Array<{ id: string; event_id: string | null }>) await mirrorContestDelete(admin, r.event_id);
  await admin.from('contests').delete().in('id', contestIds);
  return { ok: true, removed: contestIds.length };
}
