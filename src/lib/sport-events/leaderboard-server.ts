/**
 * The leaderboard — the I/O half (Events program, PR 7). One reader for
 * the leaderboard route (and later the results card): the field, the
 * cards on the minted round, the names, then computeLeaderboard — the one
 * computation. Nothing is stored.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeLeaderboard, type LeaderboardRow } from './leaderboard';
import { toLeaderboardPlayers, type CardRow, type FieldRow } from './leaderboard-rows';
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
    admin.from('sport_event_participants').select('id, profile_id, handicap_index').eq('sport_event_id', event.id).eq('status', 'accepted').eq('playing', true),
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
