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
import { contestRowFor, eventShape, gameContestRowFor, type CompetitionForLink } from './contest-link';
import { readFormatConfig, readGameConfig } from './format-config';
import { sideNamesOf } from './game';
import { readMatchRows, readRoundGroups } from './match-server';
import { shapeOf } from './types';
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
  // Track 2 PR 10: a GAME mints one fixture contest per round between the event's two ad-hoc sides.
  if (eventShape(event) === 'game') return mintGameContests(admin, event, rounds, competitionId);
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

// ── The game bridge (track 2 PR 10) ──────────────────────────────────────────

const sideRef = (eventId: string, side: 1 | 2) => `sport_event_side:${eventId}:${side}`;

/** An ad-hoc side's members = who played: replaced wholesale (a reused named side takes this game's players). */
export async function syncSideMembers(admin: Admin, entryId: string, profileIds: string[]): Promise<void> {
  const want = [...new Set(profileIds)];
  const { data: have } = await admin.from('competition_entry_members').select('profile_id').eq('entry_id', entryId);
  const present = new Set(((have ?? []) as Array<{ profile_id: string }>).map(m => m.profile_id));
  const gone = [...present].filter(p => !want.includes(p));
  if (gone.length > 0) await admin.from('competition_entry_members').delete().eq('entry_id', entryId).in('profile_id', gone);
  const missing = want.filter(p => !present.has(p));
  if (missing.length > 0) {
    const { error } = await admin.from('competition_entry_members').insert(missing.map((profile_id, i) => ({ entry_id: entryId, profile_id, position: present.size + i + 1 })));
    if (error) console.error('[contest-link] side members insert failed:', error);
  }
}

/** The event's two sides as AD-HOC entries on the competition (219): found by `source_ref`, else by the side's NAME among the ad-hoc entries (an org's standing side is reused — the shape a default team shadows), else minted. Null pre-219. */
export async function ensureSideEntries(admin: Admin, competitionId: string, eventId: string, sideNames: [string, string], members: [string[], string[]]): Promise<[string, string] | null> {
  const out: string[] = [];
  for (const side of [1, 2] as const) {
    const name = sideNames[side - 1].trim().slice(0, 80) || `Side ${side}`;
    const ref = sideRef(eventId, side);
    const { data: byRef, error } = await admin.from('competition_entries').select('id').eq('competition_id', competitionId).eq('source_ref', ref).maybeSingle();
    if (error) {
      if (missingColumn(error)) return null;
      console.error('[contest-link] side entry read failed:', error);
      return null;
    }
    let id = (byRef as { id: string } | null)?.id ?? null;
    if (!id) {
      const { data: byName } = await admin.from('competition_entries').select('id').eq('competition_id', competitionId).is('team_id', null).is('profile_id', null).ilike('name', name).limit(1).maybeSingle();
      id = (byName as { id: string } | null)?.id ?? null;
    }
    if (!id) {
      const { data: created, error: insertError } = await admin.from('competition_entries').insert({ competition_id: competitionId, team_id: null, profile_id: null, name, source_ref: ref, status: 'approved' }).select('id').single();
      if (insertError || !created) {
        if (insertError?.code === '23505') {
          const { data: again } = await admin.from('competition_entries').select('id').eq('competition_id', competitionId).is('team_id', null).is('profile_id', null).ilike('name', name).limit(1).maybeSingle();
          id = (again as { id: string } | null)?.id ?? null;
        }
        if (!id) { console.error('[contest-link] side entry insert failed:', insertError); return null; }
      } else id = (created as { id: string }).id;
    }
    await syncSideMembers(admin, id, members[side - 1]);
    out.push(id);
  }
  return [out[0], out[1]];
}

/** The players on each side of a round — the group members' SENT sides, as profile ids. */
export async function readRoundSides(admin: Admin, eventId: string, roundId: string): Promise<[string[], string[]]> {
  const [groups, { data: parts }] = await Promise.all([readRoundGroups(admin, roundId), admin.from('sport_event_participants').select('id, profile_id, status').eq('sport_event_id', eventId)]);
  const profileOf = new Map(((parts ?? []) as Array<{ id: string; profile_id: string; status: string }>).filter(p => p.status === 'accepted').map(p => [p.id, p.profile_id]));
  const sides: [string[], string[]] = [[], []];
  for (const g of groups) for (const m of g.members) {
    const profile = profileOf.get(m.participant_id);
    if (profile && (m.side === 1 || m.side === 2)) sides[m.side - 1].push(profile);
  }
  return sides;
}

/** One FIXTURE contest per non-cancelled round of a GAME event, home = side 1, away = side 2 (the ad-hoc entries above). Idempotent on the round UNIQUE. */
export async function mintGameContests(admin: Admin, event: SportEventRow, rounds: SportEventRoundRow[], competitionId: string): Promise<MintOutcome> {
  const active = rounds.filter(r => r.status !== 'cancelled').sort((a, b) => a.sequence - b.sequence);
  const existing = await readCountsToward(admin, active.map(r => r.id));
  if (existing === null) return { ok: false, contests: new Map(), reason: 'needs_migration' };
  const contests = new Map<string, string>([...existing.entries()].map(([rid, c]) => [rid, c.contestId]));
  const shape = shapeOf(event);
  const sideNames = sideNamesOf(readGameConfig(readFormatConfig(event.format_config, Math.max(1, rounds.length), event.format, shape), shape));
  for (const round of active) {
    if (contests.has(round.id)) continue;
    const members = await readRoundSides(admin, event.id, round.id);
    const entries = await ensureSideEntries(admin, competitionId, event.id, sideNames, members);
    if (!entries) return { ok: false, contests, reason: 'needs_migration' };
    const { data: contest, error } = await admin.from('contests').insert(gameContestRowFor(round, competitionId)).select('id').single();
    if (error || !contest) {
      if (missingColumn(error)) return { ok: false, contests, reason: 'needs_migration' };
      if (error?.code === '23505') {
        const again = await readCountsToward(admin, [round.id]);
        const c = again?.get(round.id);
        if (c) { contests.set(round.id, c.contestId); continue; }
      }
      console.error('[contest-link] game contest insert failed:', error);
      return { ok: false, contests, reason: 'insert' };
    }
    const contestId = (contest as { id: string }).id;
    const { error: pError } = await admin.from('contest_participants').insert([{ contest_id: contestId, entry_id: entries[0], side: 'home' }, { contest_id: contestId, entry_id: entries[1], side: 'away' }]);
    if (pError) console.error('[contest-link] game participants insert failed:', pError);
    contests.set(round.id, contestId);
  }
  return { ok: true, contests };
}

/** The contest → event door stamps the link (the ONE writer of `sport_event_round_id`): only an unlinked contest takes it. */
export async function linkContestToRound(admin: Admin, contestId: string, roundId: string): Promise<'ok' | 'already_linked' | 'needs_migration'> {
  const { data, error } = await admin.from('contests').update({ sport_event_round_id: roundId }).eq('id', contestId).is('sport_event_round_id', null).select('id');
  if (error) {
    if (missingColumn(error)) return 'needs_migration';
    console.error('[contest-link] link stamp failed:', error);
    return 'needs_migration';
  }
  return (data ?? []).length === 1 ? 'ok' : 'already_linked';
}

// ── The match bridge (track 2 PR 11, migration 220) ──────────────────────────

/** Go-live on a match round: the round-linked contest takes the minted match (`sport_event_match_id`), the round link cleared (220's CHECK: a
 *  round OR a match), the contest in progress. A pre-220 database keeps the round link (the sync falls back to it). One match per round today —
 *  the door draws one group; a bracketed event's k matches by slot is the parked step. */
export async function linkMatchesToContests(admin: Admin, roundId: string): Promise<void> {
  const links = await readCountsToward(admin, [roundId]);
  const link = links?.get(roundId);
  if (!link) return;
  const rows = await readMatchRows(admin, [roundId]);
  if (rows.length !== 1) {
    if (rows.length > 1) console.warn('[contest-link] a round with several matches links by slot — parked; the round link stays');
    return;
  }
  const { error } = await admin.from('contests').update({ sport_event_match_id: rows[0].id, sport_event_round_id: null, status: 'in_progress' }).eq('id', link.contestId);
  if (error) {
    if (missingColumn(error)) return;
    console.error('[contest-link] match link stamp failed:', error);
  }
}

export interface MatchLink {
  contestId: string;
  competitionId: string;
  competitionName: string;
  matchId: string;
  roundId: string;
}

/** The contests linked to a round's MATCHES (220) — empty pre-220, never an error. */
export async function readMatchLinks(admin: Admin, roundIds: string[]): Promise<Map<string, MatchLink>> {
  const out = new Map<string, MatchLink>();
  if (roundIds.length === 0) return out;
  const rows = await readMatchRows(admin, roundIds);
  if (rows.length === 0) return out;
  const { data, error } = await admin.from('contests').select('id, sport_event_match_id, competition:competition_id (id, name)').in('sport_event_match_id', rows.map(r => r.id));
  if (error) {
    if (!missingColumn(error)) console.error('[contest-link] match links read failed:', error);
    return out;
  }
  const roundOf = new Map(rows.map(r => [r.id, r.sport_event_round_id]));
  for (const row of (data ?? []) as Array<{ id: string; sport_event_match_id: string; competition: { id: string; name: string } | Array<{ id: string; name: string }> | null }>) {
    const c = Array.isArray(row.competition) ? row.competition[0] : row.competition;
    if (!c) continue;
    out.set(row.sport_event_match_id, { contestId: row.id, competitionId: c.id, competitionName: c.name, matchId: row.sport_event_match_id, roundId: roundOf.get(row.sport_event_match_id) as string });
  }
  return out;
}

/** Round id → its contest by EITHER link (the round's, or one of its matches'). The view's "counts toward" reads this. */
export async function readCountsTowardAll(admin: Admin, roundIds: string[]): Promise<Map<string, CountsToward> | null> {
  const byRound = await readCountsToward(admin, roundIds);
  if (byRound === null) return null;
  const byMatch = await readMatchLinks(admin, roundIds);
  for (const l of byMatch.values()) if (!byRound.has(l.roundId)) byRound.set(l.roundId, { contestId: l.contestId, competitionId: l.competitionId, competitionName: l.competitionName });
  return byRound;
}

/** The hand writers' question (PR 11): is this contest a match's? (null pre-220 or unlinked.) */
export async function readSportEventMatchLink(admin: Admin, contestId: string): Promise<string | null> {
  const { data, error } = await admin.from('contests').select('sport_event_match_id').eq('id', contestId).maybeSingle();
  if (error || !data) return null;
  return (data as { sport_event_match_id: string | null }).sport_event_match_id ?? null;
}
