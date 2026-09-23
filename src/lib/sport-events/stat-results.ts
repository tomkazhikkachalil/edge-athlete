/**
 * A stat round's results (Events program, phase 4) — pure. At completion
 * every fielded player with at least one finite stat (and not hidden by
 * the opt-out) gets ONE stat-line POST — the existing `stat_line` shape
 * the profile tiles, the highlights and `StatLineCard` already render —
 * found again by `stats_data.sport_event_stat_line_id` (never
 * `posts.sport_event_round_id`: 203's UNIQUE is the round's ONE post).
 * That one post flips to `sport_event_results` (the score, the sides,
 * the top lines). The performance row is `fromStatLinePost` over the
 * post (the origin row IS the post — 194's rule) with the event's
 * provenance as an overlay.
 */
import type { ResultProvenance } from '@/lib/orgs/provenance';
import { getStatSchema, type StatLineData } from '@/lib/sports/stat-schemas';
import { resultFor, resultScore, type GameScore } from './game';
import { postVisibilityFor } from './mint';
import { heroValue, lineHeadline, type StatValues } from './stats';
import type { SportEventRow, SportEventShape } from './types';
import { type OrgKindRow, orgKindOf } from '@/lib/orgs/org-ref';

export interface ResultLineInput {
  id: string;
  participant_id: string;
  profile_id: string;
  stats: StatValues;
  side: 1 | 2 | null;
  /** The masked name (the view's rule) — for the round post's summary only. */
  name: string;
  /** Who last entered the line (a recorder / organizer / the player). */
  entered_by: string | null;
}

export interface StatLinePostData extends StatLineData {
  sport_event_id: string;
  sport_event_round_id: string;
  sport_event_stat_line_id: string;
}

/** A line mirrors only when something was entered — an untouched line is not a game played. */
export function lineHasStats(stats: StatValues): boolean {
  return Object.values(stats).some(v => typeof v === 'number' && Number.isFinite(v) && v !== 0);
}

/** The `stats_data` of a player's results post. Opponent = the other side's name on a game, else the event's name. */
export function statLinePostData(event: Pick<SportEventRow, 'id' | 'name' | 'sport_key'>, round: { id: string; scheduled_on: string }, line: Pick<ResultLineInput, 'id' | 'stats' | 'side'>, game: { score: GameScore; sides: [string, string] } | null): StatLinePostData {
  const finite: StatValues = {};
  for (const [k, v] of Object.entries(line.stats)) if (typeof v === 'number' && Number.isFinite(v)) finite[k] = v;
  const base: StatLinePostData = {
    type: 'stat_line',
    sport_key: event.sport_key as StatLineData['sport_key'],
    date: round.scheduled_on,
    stats: finite,
    sport_event_id: event.id,
    sport_event_round_id: round.id,
    sport_event_stat_line_id: line.id,
  };
  if (game && line.side) {
    const opponent = game.sides[line.side === 1 ? 1 : 0];
    const result = resultFor(line.side, game.score);
    const score = resultScore(line.side, game.score);
    return { ...base, opponent, ...(result ? { result } : {}), ...(score ? { result_score: score } : {}) };
  }
  return { ...base, opponent: event.name };
}

/** "Friday skate · Jun 1, 2030" — the mirrored post's caption. */
export function statLinePostCaption(event: Pick<SportEventRow, 'name'>, round: { scheduled_on: string }): string {
  return `${event.name} · ${round.scheduled_on}`;
}

/** The posts row for one line (the supervised carve-out: published at once, like a shared round; `created_by_user_id` names the guardian when one hosts). */
export function statLinePostRow(event: Pick<SportEventRow, 'id' | 'name' | 'sport_key' | 'visibility'>, round: { id: string; scheduled_on: string }, line: ResultLineInput, game: { score: GameScore; sides: [string, string] } | null, createdByUserId: string | null) {
  return {
    profile_id: line.profile_id,
    ...(createdByUserId && createdByUserId !== line.profile_id ? { created_by_user_id: createdByUserId } : {}),
    sport_key: event.sport_key,
    caption: statLinePostCaption(event, round),
    visibility: postVisibilityFor(event),
    stats_data: statLinePostData(event, round, line, game),
    tags: [] as string[],
    hashtags: [] as string[],
    likes_count: 0,
    comments_count: 0,
  };
}

export interface SportEventResultsData {
  type: 'sport_event_results';
  sport_event_id: string;
  sport_event_round_id: string;
  shape: SportEventShape;
  score: GameScore | null;
  sides: Array<{ side: 1 | 2; name: string; players: Array<{ name: string; headline: string | null }> }>;
  top: Array<{ name: string; headline: string | null }>;
}

export function isSportEventResultsData(v: unknown): v is SportEventResultsData {
  return !!v && typeof v === 'object' && (v as { type?: unknown }).type === 'sport_event_results' && Array.isArray((v as { sides?: unknown }).sides);
}

/** The round's ONE post at completion: the score, each side's players with their headline, the top three lines by the hero value. */
export function resultsPostData(event: Pick<SportEventRow, 'id' | 'sport_key'>, round: { id: string }, shape: SportEventShape, lines: ReadonlyArray<ResultLineInput>, game: { score: GameScore; sides: [string, string] } | null): SportEventResultsData {
  const schema = getStatSchema(event.sport_key);
  const headline = (stats: StatValues) => (schema ? lineHeadline(stats, schema) : null);
  const played = lines.filter(l => lineHasStats(l.stats));
  const sides: SportEventResultsData['sides'] = game
    ? ([1, 2] as const).map(side => ({ side, name: game.sides[side - 1], players: lines.filter(l => l.side === side).map(l => ({ name: l.name, headline: headline(l.stats) })) }))
    : [];
  const top = [...played]
    .sort((a, b) => (schema ? heroValue(b.stats, schema) - heroValue(a.stats, schema) : 0))
    .slice(0, 3)
    .map(l => ({ name: l.name, headline: headline(l.stats) }));
  return { type: 'sport_event_results', sport_event_id: event.id, sport_event_round_id: round.id, shape, score: game ? game.score : null, sides, top };
}

/** The performance overlay of a mirrored line: an org-hosted event's recorder / organizer entry is the org's; a player's own (or an athlete-run event) is self-reported. */
export function provenanceForLine(event: OrgKindRow, line: Pick<ResultLineInput, 'profile_id' | 'entered_by'>): ResultProvenance {
  const org = orgKindOf(event);
  if (!org) return 'self_reported';
  if (line.entered_by && line.entered_by !== line.profile_id) return org === 'league' ? 'league_verified' : 'club_recorded';
  return 'self_reported';
}
