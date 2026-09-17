/**
 * What the mint writes (Events program, PR 5) — pure row builders, so the
 * shapes are pinned by tests and lifecycle-server.ts is plain sequencing.
 *
 * ONE post per round, three states: minted at Open (announced — no
 * group_post yet), attached at go-live (live — `posts.group_post_id`), the
 * score-led card at completion (results — the End Round timestamp bump).
 * The round's group_posts row is minted at go-live from buildMintPlan and
 * carries `sport_event_round_id` (203); its scorecard keeps the STROKE
 * INDEX so the live board can allocate net strokes.
 */
import type { MintPlan } from './rounds';
import { roundVisibility } from './rounds';
import type { SportEventRoundRow, SportEventRow } from './types';

/** posts.visibility admits public | private | followers — never the group vocabulary. */
export function postVisibilityFor(event: Pick<SportEventRow, 'visibility'>): 'public' | 'private' {
  return event.visibility === 'public' ? 'public' : 'private';
}

export function roundTitle(event: Pick<SportEventRow, 'name'>, round: Pick<SportEventRoundRow, 'sequence'>, roundCount: number): string {
  return roundCount > 1 ? `${event.name} — Round ${round.sequence}` : event.name;
}

export function announceCaption(event: Pick<SportEventRow, 'name' | 'description'>, round: Pick<SportEventRoundRow, 'course_name' | 'scheduled_on'>): string {
  const head = `${event.name} · ${round.course_name} · ${round.scheduled_on}`;
  return event.description ? `${head}\n${event.description}` : head;
}

export function announcePostRow(event: Pick<SportEventRow, 'id' | 'host_profile_id' | 'created_by_user_id' | 'sport_key' | 'name' | 'description' | 'visibility'>, round: Pick<SportEventRoundRow, 'id' | 'course_name' | 'scheduled_on'>) {
  return {
    profile_id: event.host_profile_id,
    ...(event.created_by_user_id && event.created_by_user_id !== event.host_profile_id ? { created_by_user_id: event.created_by_user_id } : {}),
    sport_key: event.sport_key,
    caption: announceCaption(event, round),
    visibility: postVisibilityFor(event),
    sport_event_round_id: round.id,
    stats_data: { type: 'sport_event_announce', sport_event_id: event.id, sport_event_round_id: round.id },
    tags: [] as string[],
    hashtags: [] as string[],
    likes_count: 0,
    comments_count: 0,
  };
}

export function groupPostRow(event: Pick<SportEventRow, 'host_profile_id' | 'name' | 'description' | 'visibility'>, round: Pick<SportEventRoundRow, 'id' | 'sequence' | 'course_name' | 'scheduled_on'>, opts: { roundCount: number; date: string }) {
  return {
    creator_id: event.host_profile_id,
    type: 'golf_round' as const,
    title: roundTitle(event, round, opts.roundCount),
    description: event.description,
    date: opts.date,
    location: round.course_name,
    visibility: roundVisibility(event.visibility),
    status: 'pending' as const,
    sport_event_round_id: round.id,
  };
}

/** `gameFormat` (phase 3): 'match' on a match-format round — 032's CHECK admits it; the card readers never branch on it. */
export function scorecardRow(round: Pick<SportEventRoundRow, 'course_name' | 'course_id' | 'holes' | 'tee' | 'slope_rating' | 'course_rating' | 'hole_data'>, groupPostId: string, gameFormat: 'stroke' | 'match' | 'stableford' = 'stroke') {
  return {
    group_post_id: groupPostId,
    course_name: round.course_name,
    course_id: round.course_id,
    round_type: 'outdoor' as const,
    game_format: gameFormat,
    holes_played: round.holes,
    tee_color: round.tee,
    slope_rating: round.slope_rating,
    course_rating: round.course_rating,
    hole_data: round.hole_data && round.hole_data.length > 0
      ? round.hole_data.map(h => ({ hole: h.hole, par: h.par, ...(typeof h.yardage === 'number' && h.yardage > 0 ? { yardage: h.yardage } : {}), ...(typeof h.handicap === 'number' ? { handicap: h.handicap } : {}) }))
      : null,
  };
}

export function participantRows(plan: MintPlan, groupPostId: string, now: string) {
  return plan.participantRows.map(r => ({ group_post_id: groupPostId, profile_id: r.profile_id, role: r.role, status: r.status, attested_at: now, position: r.position }));
}
