/**
 * The leaderboard — the I/O half (Events program, PR 7). One reader for
 * the leaderboard route (and later the results card): the field, the
 * cards on the minted round, the names, then computeLeaderboard — the one
 * computation. Nothing is stored. Phase 2: `fetchOverallLeaderboard` folds
 * the minted rounds' boards through computeOverallLeaderboard (overall.ts)
 * — the tournament's board, also never stored.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeLeaderboard, type LeaderboardRow } from './leaderboard';
import { toLeaderboardPlayers, type CardRow, type FieldRow } from './leaderboard-rows';
import { computeOverallLeaderboard, type OverallBoard, type OverallOptions } from './overall';
import type { SportEventRoundRow, SportEventRow } from './types';
import type { ProfileForView } from './view';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface RoundLeaderboard {
  round: { id: string; sequence: number; status: string; scheduled_on: string; course_name: string; holes: number; starting_hole: number; course_rating: number | null; slope_rating: number | null; group_post_id: string | null };
  format: SportEventRow['format'];
  rows: LeaderboardRow[];
  computed_at: string;
}

export async function fetchRoundLeaderboard(admin: Admin, event: SportEventRow, round: SportEventRoundRow): Promise<RoundLeaderboard> {
  const [{ data: fieldRows }, { data: gp }] = await Promise.all([
    admin.from('sport_event_participants').select('id, profile_id, handicap_index, flight').eq('sport_event_id', event.id).eq('status', 'accepted').eq('playing', true),
    admin.from('group_posts').select('id').eq('sport_event_round_id', round.id).maybeSingle(),
  ]);
  const field = (fieldRows ?? []) as FieldRow[];
  const groupPostId = (gp?.id as string | undefined) ?? null;

  let cards: CardRow[] = [];
  if (groupPostId) {
    const { data } = await admin
      .from('group_post_participants')
      .select('profile_id, status, card:golf_participant_scores (status, hole_scores:golf_hole_scores (hole_number, strokes))')
      .eq('group_post_id', groupPostId);
    cards = ((data ?? []) as Array<{ profile_id: string; status: string; card: CardRow['card'] | CardRow['card'][] }>).map(r => ({ profile_id: r.profile_id, status: r.status, card: Array.isArray(r.card) ? (r.card[0] ?? null) : r.card }));
  }

  const profiles = new Map<string, ProfileForView>();
  if (field.length > 0) {
    const { data } = await admin.from('profiles').select('id, first_name, last_name, full_name, visibility, email, supervision_state, handle, avatar_url').in('id', field.map(f => f.profile_id));
    for (const p of (data ?? []) as ProfileForView[]) profiles.set(p.id, p);
  }

  const rows = computeLeaderboard({
    format: event.format,
    holes: round.holes,
    startingHole: round.starting_hole,
    holeData: round.hole_data,
    courseRating: round.course_rating,
    slopeRating: round.slope_rating,
    players: toLeaderboardPlayers(field, cards, profiles),
  });
  return {
    round: { id: round.id, sequence: round.sequence, status: round.status, scheduled_on: round.scheduled_on, course_name: round.course_name, holes: round.holes, starting_hole: round.starting_hole, course_rating: round.course_rating, slope_rating: round.slope_rating, group_post_id: groupPostId },
    format: event.format,
    rows,
    computed_at: new Date().toISOString(),
  };
}

export interface OverallLeaderboard {
  event: { id: string; format: SportEventRow['format']; status: SportEventRow['status'] };
  /** Every non-cancelled round in sequence order — the column headers (a scheduled round has no cells yet). */
  rounds: Array<{ id: string; sequence: number; status: string; scheduled_on: string; course_name: string; holes: number; group_post_id: string | null }>;
  board: OverallBoard;
  computed_at: string;
}

/** The tournament's board: the minted rounds' boards, folded (phase 2). Computed on every request. */
export async function fetchOverallLeaderboard(admin: Admin, event: SportEventRow, rounds: SportEventRoundRow[], options: OverallOptions = {}): Promise<OverallLeaderboard> {
  const active = [...rounds].filter(r => r.status !== 'cancelled').sort((a, b) => a.sequence - b.sequence);
  const minted = active.filter(r => r.status === 'live' || r.status === 'completed');
  const boards = await Promise.all(minted.map(r => fetchRoundLeaderboard(admin, event, r)));
  const board = computeOverallLeaderboard(
    boards.map((b, i) => ({ roundId: minted[i].id, sequence: minted[i].sequence, status: minted[i].status, holes: minted[i].holes, rows: b.rows })),
    event.format,
    options,
  );
  const gpByRound = new Map<string, string | null>();
  boards.forEach((b, i) => gpByRound.set(minted[i].id, b.round.group_post_id));
  return {
    event: { id: event.id, format: event.format, status: event.status },
    rounds: active.map(r => ({ id: r.id, sequence: r.sequence, status: r.status, scheduled_on: r.scheduled_on, course_name: r.course_name, holes: r.holes, group_post_id: gpByRound.get(r.id) ?? null })),
    board,
    computed_at: new Date().toISOString(),
  };
}
