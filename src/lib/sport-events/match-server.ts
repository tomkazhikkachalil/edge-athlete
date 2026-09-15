/**
 * Matches — the I/O half (Events program, phase 3, PR 5; migration 212
 * `sport_event_matches`). ONE reader, `fetchRoundMatches`: the round's
 * draw (groups + members with sides), the match rows, the cards on the
 * minted round, the names and the playing handicaps, then `computeMatch`
 * — the one computation, never stored while live. The mint (`mintMatches`,
 * one row per group, idempotent on the group UNIQUE; a bye decided at
 * mint), the completion writer (`closeMatchesOnCompletion`, the outcome
 * written ONCE for every match not yet stored-decided) and the one CAS
 * writer (`writeMatch`: UPDATE … WHERE id AND version = seen; 0 rows =
 * conflict) live here so the routes (PR 6) are plain sequencing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicDisplayName, publicHandle } from '@/lib/orgs/public-names';
import { readFormatConfig, readMatchConfig } from './format-config';
import { courseHandicapFor, playedPar } from './handicap';
import { completionSnapshot, computeMatch, holeOrderFor, sidesOf, type Concession, type ExtraHole, type MatchFormat, type MatchInput, type MatchPlayer, type MatchState, type Side, type StoredDecision } from './match';
import type { MatchSides, SportEventRoundRow, SportEventRow } from './types';
import type { ProfileForView } from './view';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const MATCH_COLUMNS = 'id, sport_event_round_id, group_id, concessions, extra_holes, decided_by, winner_side, result, decided_at, version, created_at, updated_at';

export interface MatchRow {
  id: string;
  sport_event_round_id: string;
  group_id: string;
  concessions: unknown;
  extra_holes: unknown;
  decided_by: string | null;
  winner_side: number | null;
  result: string | null;
  decided_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RoundGroup {
  id: string;
  sequence: number;
  name: string | null;
  starting_hole: number;
  tee_time: string | null;
  members: Array<{ participant_id: string; position: number; side: Side | null }>;
}

export interface MatchSideView {
  side: Side;
  members: Array<{ participant_id: string; profile_id: string; name: string; handle: string | null; avatar_url: string | null }>;
  /** Whose cards count for the side: everyone, or the captain alone on foursomes. */
  card_participant_ids: string[];
}

export interface RoundMatch {
  id: string;
  version: number;
  round_id: string;
  group: { id: string; sequence: number; name: string | null; starting_hole: number; tee_time: string | null };
  sides: [MatchSideView, MatchSideView];
  bye: boolean;
  input: MatchInput;
  state: MatchState;
  stored: { decided_by: string | null; winner_side: Side | null; result: string | null; decided_at: string | null };
}

/** A round's groups with their members (sides included), in sequence order. */
export async function readRoundGroups(admin: Admin, roundId: string): Promise<RoundGroup[]> {
  const [{ data: groups }, { data: members }] = await Promise.all([
    admin.from('sport_event_groups').select('id, sequence, name, starting_hole, tee_time').eq('sport_event_round_id', roundId).order('sequence', { ascending: true }),
    admin.from('sport_event_group_members').select('group_id, participant_id, position, side').eq('sport_event_round_id', roundId).order('position', { ascending: true }),
  ]);
  const rows = (members ?? []) as Array<{ group_id: string; participant_id: string; position: number; side: number | null }>;
  return ((groups ?? []) as Array<{ id: string; sequence: number; name: string | null; starting_hole: number; tee_time: string | null }>).map(g => ({
    ...g,
    members: rows.filter(m => m.group_id === g.id).map(m => ({ participant_id: m.participant_id, position: m.position, side: m.side === 1 || m.side === 2 ? m.side : null })),
  }));
}

export async function readMatchRows(admin: Admin, roundIds: string[]): Promise<MatchRow[]> {
  if (roundIds.length === 0) return [];
  const { data, error } = await admin.from('sport_event_matches').select(MATCH_COLUMNS).in('sport_event_round_id', roundIds);
  if (error) console.error('[sport-events match] read failed:', error);
  return (data ?? []) as MatchRow[];
}

/** The stored jsonb, tolerantly (a hand-written row never breaks a read). */
export function parseConcessions(raw: unknown): Concession[] {
  if (!Array.isArray(raw)) return [];
  const out: Concession[] = [];
  for (const c of raw as Array<Record<string, unknown>>) {
    if (!c || typeof c !== 'object') continue;
    const hole = c.hole === null ? null : typeof c.hole === 'number' && Number.isInteger(c.hole) ? c.hole : undefined;
    if (hole === undefined || (c.by_side !== 1 && c.by_side !== 2) || typeof c.by !== 'string') continue;
    out.push({ hole, by_side: c.by_side, by: c.by, at: typeof c.at === 'string' ? c.at : '' });
  }
  return out;
}

export function parseExtraHoles(raw: unknown): ExtraHole[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtraHole[] = [];
  for (const e of raw as Array<Record<string, unknown>>) {
    if (!e || typeof e !== 'object' || typeof e.n !== 'number' || typeof e.hole_number !== 'number') continue;
    const strokes: Record<string, number | null> = {};
    if (e.strokes && typeof e.strokes === 'object') for (const [k, v] of Object.entries(e.strokes as Record<string, unknown>)) strokes[k] = typeof v === 'number' ? v : null;
    out.push({ n: e.n, hole_number: e.hole_number, strokes });
  }
  return out;
}

/** The decision a row stores that the computation must honour (holes / extra_holes are re-derived from the cards). */
export function storedDecisionOf(row: Pick<MatchRow, 'decided_by' | 'winner_side'>): StoredDecision {
  if ((row.decided_by === 'organizer' || row.decided_by === 'concession' || row.decided_by === 'bye') && (row.winner_side === 1 || row.winner_side === 2)) return { decided_by: row.decided_by, winner_side: row.winner_side };
  return null;
}

/**
 * Every match of a round, computed on read. Groups without a match row
 * (before the mint) yield nothing; a group whose sides no longer fit the
 * format is skipped (the PUT is refused once the round is live, so this
 * never happens after a start).
 */
export async function fetchRoundMatches(admin: Admin, event: SportEventRow, round: SportEventRoundRow, opts: { groups?: RoundGroup[]; rows?: MatchRow[] } = {}): Promise<RoundMatch[]> {
  const match = readMatchConfig(readFormatConfig(event.format_config, 8, event.format), event.format);
  if (!match) return [];
  const [groups, rows] = await Promise.all([opts.groups ?? readRoundGroups(admin, round.id), opts.rows ?? readMatchRows(admin, [round.id])]);
  const rowByGroup = new Map(rows.map(r => [r.group_id, r]));
  const memberIds = [...new Set(groups.flatMap(g => g.members.map(m => m.participant_id)))];
  if (memberIds.length === 0) return [];

  const [{ data: participantRows }, { data: gp }] = await Promise.all([
    admin.from('sport_event_participants').select('id, profile_id, handicap_index').in('id', memberIds),
    admin.from('group_posts').select('id').eq('sport_event_round_id', round.id).maybeSingle(),
  ]);
  const participants = new Map(((participantRows ?? []) as Array<{ id: string; profile_id: string; handicap_index: number | null }>).map(p => [p.id, p]));
  const profileIds = [...new Set([...participants.values()].map(p => p.profile_id))];
  const [{ data: profileRows }, cardsRes] = await Promise.all([
    profileIds.length > 0 ? admin.from('profiles').select('id, first_name, last_name, full_name, visibility, email, supervision_state, handle, avatar_url').in('id', profileIds) : Promise.resolve({ data: [] as ProfileForView[] }),
    gp?.id
      ? admin.from('group_post_participants').select('profile_id, status, card:golf_participant_scores (hole_scores:golf_hole_scores (hole_number, strokes))').eq('group_post_id', gp.id as string)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const profiles = new Map(((profileRows ?? []) as ProfileForView[]).map(p => [p.id, p]));
  const scoresByProfile = new Map<string, Array<{ hole_number: number; strokes: number | null }>>();
  for (const r of (cardsRes.data ?? []) as Array<{ profile_id: string; status: string; card: { hole_scores: Array<{ hole_number: number; strokes: number | null }> } | Array<{ hole_scores: Array<{ hole_number: number; strokes: number | null }> }> | null }>) {
    if (r.status === 'declined') continue;
    const card = Array.isArray(r.card) ? (r.card[0] ?? null) : r.card;
    scoresByProfile.set(r.profile_id, card?.hole_scores ?? []);
  }
  const handicapRound = { holes: round.holes, course_rating: round.course_rating, slope_rating: round.slope_rating, par: playedPar(round.hole_data) };

  const player = (participantId: string, position: number): MatchPlayer | null => {
    const p = participants.get(participantId);
    if (!p) return null;
    const profile = profiles.get(p.profile_id) ?? null;
    return {
      participantId,
      profileId: p.profile_id,
      name: profile ? publicDisplayName(profile) : 'Athlete',
      position,
      courseHandicap: courseHandicapFor(p, handicapRound),
      holeScores: scoresByProfile.get(p.profile_id) ?? [],
    };
  };
  const sideView = (side: Side, ids: string[], sides: MatchSides): MatchSideView => ({
    side,
    members: ids.map(id => {
      const p = participants.get(id);
      const profile = p ? profiles.get(p.profile_id) ?? null : null;
      return { participant_id: id, profile_id: p?.profile_id ?? '', name: profile ? publicDisplayName(profile) : 'Athlete', handle: profile ? publicHandle(profile) : null, avatar_url: profile?.avatar_url ?? null };
    }),
    card_participant_ids: sides === 'foursomes' ? ids.slice(0, 1) : ids,
  });

  const out: RoundMatch[] = [];
  for (const g of [...groups].sort((a, b) => a.sequence - b.sequence)) {
    const row = rowByGroup.get(g.id);
    if (!row) continue;
    const split = sidesOf(g.members, match.sides, { allowBye: true });
    if (!split.ok) continue;
    const players = (ids: string[]) => ids.map((id, i) => player(id, i + 1)).filter((p): p is MatchPlayer => p !== null);
    const input: MatchInput = {
      format: event.format as MatchFormat,
      sides: match.sides,
      allowancePct: match.allowance,
      holes: round.holes,
      holeOrder: holeOrderFor(round, g.starting_hole),
      holeData: round.hole_data,
      sideA: { side: 1, players: players(split.a) },
      sideB: { side: 2, players: players(split.b) },
      concessions: parseConcessions(row.concessions),
      extraHoles: parseExtraHoles(row.extra_holes),
      decision: storedDecisionOf(row),
    };
    out.push({
      id: row.id,
      version: row.version,
      round_id: round.id,
      group: { id: g.id, sequence: g.sequence, name: g.name, starting_hole: g.starting_hole, tee_time: g.tee_time },
      sides: [sideView(1, split.a, match.sides), sideView(2, split.b, match.sides)],
      bye: split.bye,
      input,
      state: computeMatch(input),
      stored: { decided_by: row.decided_by, winner_side: row.winner_side === 1 || row.winner_side === 2 ? row.winner_side : null, result: row.result, decided_at: row.decided_at },
    });
  }
  return out;
}

/** One match row per group at the round's start — idempotent on the group UNIQUE; a one-side group (a bracket bye) is decided at mint. */
export async function mintMatches(admin: Admin, roundId: string, groups: RoundGroup[], match: { sides: MatchSides; bracket: boolean }, now: string): Promise<boolean> {
  if (groups.length === 0) return true;
  const rows = groups.map(g => {
    const split = sidesOf(g.members, match.sides, { allowBye: match.bracket });
    const bye = split.ok && split.bye;
    const winner: Side | null = bye ? (split.a.length > 0 ? 1 : 2) : null;
    return { sport_event_round_id: roundId, group_id: g.id, ...(bye ? { decided_by: 'bye', winner_side: winner, result: 'bye', decided_at: now } : {}) };
  });
  const { error } = await admin.from('sport_event_matches').upsert(rows, { onConflict: 'group_id', ignoreDuplicates: true });
  if (error) {
    console.error('[sport-events match] mint failed:', error);
    return false;
  }
  return true;
}

/** Round completion writes the outcome ONCE for every match decided by the holes or the extra holes (a concession, a decision or a bye was stored at the act). Best-effort, a CAS per row. */
export async function closeMatchesOnCompletion(admin: Admin, matches: RoundMatch[], now: string): Promise<void> {
  for (const m of matches) {
    if (m.stored.decided_by) continue;
    const snap = completionSnapshot(m.state);
    if (!snap) continue;
    const outcome = await writeMatch(admin, m.id, m.version, { ...snap, decided_at: now });
    if (outcome !== 'ok') console.error('[sport-events match] completion write:', outcome, m.id);
  }
}

/** The ONE writer: a compare-and-set on `version` (0 rows = someone else wrote first; the caller re-reads and replays — never a forced overwrite). */
export async function writeMatch(admin: Admin, matchId: string, version: number, patch: Record<string, unknown>): Promise<'ok' | 'conflict' | 'error'> {
  const { data, error } = await admin.from('sport_event_matches').update({ ...patch, version: version + 1 }).eq('id', matchId).eq('version', version).select('id').maybeSingle();
  if (error) {
    console.error('[sport-events match] write failed:', error);
    return 'error';
  }
  return data ? 'ok' : 'conflict';
}
