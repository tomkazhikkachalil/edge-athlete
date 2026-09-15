/**
 * Breakdowns — the I/O half (Events program, phase 2). One reader for the
 * breakdown route: the field, every minted round's cards WITH the five
 * hole fields (the leaderboard reads strokes only), the names, then the
 * pure breakdown per player per round, the tournament aggregate, and the
 * hardest holes. Computed on every request; nothing stored.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HardestHole } from '@/lib/golf/course-stats';
import { publicDisplayName, publicHandle } from '@/lib/orgs/public-names';
import { aggregateBreakdowns, eventHardestHoles, playerBreakdown, parMap, type BreakdownHole, type PlayerBreakdown } from './breakdown';
import type { SportEventRoundRow, SportEventRow } from './types';
import type { ProfileForView } from './view';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface BreakdownPlayer {
  participantId: string;
  profileId: string;
  name: string;
  handle: string | null;
  flight: string | null;
  holes: BreakdownHole[];
  breakdown: PlayerBreakdown;
}

export interface RoundBreakdown {
  round: { id: string; sequence: number; status: string; holes: number; starting_hole: number; course_name: string; pars: Array<{ hole: number; par: number }> };
  players: BreakdownPlayer[];
  hardest: HardestHole[];
}

export interface EventBreakdown {
  event: { id: string; format: SportEventRow['format'] };
  /** The minted rounds in sequence order (one when `round` names it). */
  rounds: RoundBreakdown[];
  /** The tournament aggregate — present when more than one round is on the payload. `hardest` is empty when the rounds differ in course or range. */
  overall: { players: Array<Omit<BreakdownPlayer, 'holes'>>; hardest: HardestHole[] } | null;
  computed_at: string;
}

interface CardRow {
  profile_id: string;
  status: string;
  card: { hole_scores: BreakdownHole[] } | Array<{ hole_scores: BreakdownHole[] }> | null;
}

export async function fetchBreakdown(admin: Admin, event: SportEventRow, rounds: SportEventRoundRow[], opts: { round: 'all' | string; participant?: string | null }): Promise<EventBreakdown> {
  const minted = [...rounds]
    .filter(r => r.status !== 'cancelled' && (r.status === 'live' || r.status === 'completed'))
    .filter(r => opts.round === 'all' || r.id === opts.round)
    .sort((a, b) => a.sequence - b.sequence);

  let fieldQuery = admin.from('sport_event_participants').select('id, profile_id, flight').eq('sport_event_id', event.id).eq('status', 'accepted').eq('playing', true);
  if (opts.participant) fieldQuery = fieldQuery.eq('id', opts.participant);
  const { data: fieldRows } = await fieldQuery;
  const field = (fieldRows ?? []) as Array<{ id: string; profile_id: string; flight: string | null }>;

  const profiles = new Map<string, ProfileForView>();
  if (field.length > 0) {
    const { data } = await admin.from('profiles').select('id, first_name, last_name, full_name, visibility, email, supervision_state, handle, avatar_url').in('id', field.map(f => f.profile_id));
    for (const p of (data ?? []) as ProfileForView[]) profiles.set(p.id, p);
  }
  const nameOf = (profileId: string) => { const p = profiles.get(profileId); return { name: p ? publicDisplayName(p) : 'Athlete', handle: p ? publicHandle(p) : null }; };

  const roundIds = minted.map(r => r.id);
  const gpByRound = new Map<string, string>();
  if (roundIds.length > 0) {
    const { data: gps } = await admin.from('group_posts').select('id, sport_event_round_id').in('sport_event_round_id', roundIds);
    for (const g of (gps ?? []) as Array<{ id: string; sport_event_round_id: string }>) gpByRound.set(g.sport_event_round_id, g.id);
  }

  const out: RoundBreakdown[] = [];
  for (const r of minted) {
    const gp = gpByRound.get(r.id) ?? null;
    const holesByProfile = new Map<string, BreakdownHole[]>();
    if (gp) {
      const { data } = await admin
        .from('group_post_participants')
        .select('profile_id, status, card:golf_participant_scores (hole_scores:golf_hole_scores (hole_number, strokes, putts, fairway_hit, green_in_regulation, penalties))')
        .eq('group_post_id', gp);
      for (const row of (data ?? []) as CardRow[]) {
        if (row.status === 'declined') continue;
        const card = Array.isArray(row.card) ? (row.card[0] ?? null) : row.card;
        holesByProfile.set(row.profile_id, card?.hole_scores ?? []);
      }
    }
    const range = { holes: r.holes, startingHole: r.starting_hole };
    const pars = [...parMap(r.hole_data, range).entries()].map(([hole, par]) => ({ hole, par })).sort((a, b) => a.hole - b.hole);
    const players: BreakdownPlayer[] = field.map(f => {
      const holes = holesByProfile.get(f.profile_id) ?? [];
      return { participantId: f.id, profileId: f.profile_id, ...nameOf(f.profile_id), flight: f.flight ?? null, holes, breakdown: playerBreakdown(holes, r.hole_data, range) };
    });
    out.push({
      round: { id: r.id, sequence: r.sequence, status: r.status, holes: r.holes, starting_hole: r.starting_hole, course_name: r.course_name, pars },
      players,
      hardest: eventHardestHoles(players.map(p => ({ holes: p.holes })), r.hole_data, range),
    });
  }

  let overall: EventBreakdown['overall'] = null;
  if (out.length > 1) {
    const players = field.map(f => {
      const per = out.map(r => r.players.find(p => p.participantId === f.id)?.breakdown).filter((b): b is PlayerBreakdown => !!b);
      return { participantId: f.id, profileId: f.profile_id, ...nameOf(f.profile_id), flight: f.flight ?? null, breakdown: aggregateBreakdowns(per) };
    });
    const first = minted[0];
    const sameCourse = minted.every(r => r.course_name === first.course_name && r.holes === first.holes && r.starting_hole === first.starting_hole);
    const hardest = sameCourse
      ? eventHardestHoles(out.flatMap(r => r.players.map(p => ({ holes: p.holes }))), first.hole_data, { holes: first.holes, startingHole: first.starting_hole })
      : [];
    overall = { players, hardest };
  }

  return { event: { id: event.id, format: event.format }, rounds: out, overall, computed_at: new Date().toISOString() };
}
