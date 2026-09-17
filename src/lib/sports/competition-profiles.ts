/**
 * Sport competition profiles (Competition formats program, track 2, PR 1 —
 * Sep 16 2026) — PURE DATA, the stat-schemas precedent. NOT on
 * `SportAdapter` (I/O class methods; the org route and the standings
 * recompute must never import a browser-facing adapter). ONE owner for
 * "what may this sport's competition look like": which formats, which
 * entrant kinds each format takes, the default scoring rule and the rules
 * on offer (keys into competitions/scoring.ts's registries — a test pins
 * that every key exists there), a meet's event vocabulary (built from
 * `TRACK_EVENTS` — one vocabulary with the stat schema and the PB tiles),
 * the team-score stat a game's live score is checked against, and the
 * result-payload validator per format.
 *
 * The two per-sport default maps that lived in scoring.ts moved here.
 * Zero imports of scoring.ts (scoring reads THIS; never the reverse).
 */
import { TRACK_EVENTS } from './stat-schemas';

export const COMPETITION_FORMATS = ['fixture', 'leaderboard', 'bracket', 'meet'] as const;
export type CompetitionFormat = (typeof COMPETITION_FORMATS)[number];

export const ENTRANT_KINDS = ['team', 'athlete', 'ad_hoc_team'] as const;
export type EntrantKind = (typeof ENTRANT_KINDS)[number];

export interface FormatProfile {
  /** The entrant kinds this format takes for this sport — the FIRST is the default. */
  entrants: readonly EntrantKind[];
  /** The scoring registry key used when the competition stores none; null = the format computes without a rule (bracket, meet). */
  defaultRule: string | null;
  /** The rules the org may pick from (registry keys). */
  rules: readonly string[];
}

export interface MeetEventDef {
  key: string;
  label: string;
  unit: 's' | 'm';
  /** Which way a better mark points: a time ascends, a distance descends. */
  direction: 'asc' | 'desc';
  /** Leftovers PR 3: a RELAY takes a named team of legs (an ad-hoc entry with members), never an athlete; its mark is no personal stat. */
  relay?: boolean;
  legs?: number;
}

export type PayloadCheck = { ok: true } | { ok: false; error: string };

export interface CompetitionProfile {
  sportKey: string;
  formats: Partial<Record<CompetitionFormat, FormatProfile>>;
  /** A meet's events (track 2 PR 7); absent = the sport has no meet. */
  meetEvents?: readonly MeetEventDef[];
  /** The default per-place points of a meet (1st … nth), non-increasing. */
  defaultMeetPoints?: readonly number[];
  /** The stat-schema key a game's live score is summed from (reported, never blocking); null = none. */
  teamScoreStat: string | null;
  /** The result payload's shape check per format — a miss names the field. */
  validateResultPayload: (format: CompetitionFormat, payload: unknown) => PayloadCheck;
}

const FIXTURE_RULES_ON_OFFER = ['points_2_1_0', 'points_3_1_0'] as const;
const GOLF_RULES_ON_OFFER = ['golf_gross', 'golf_net', 'stroke_total', 'golf_points'] as const;
export const DEFAULT_MEET_POINTS: readonly number[] = [10, 8, 6, 5, 4, 3, 2, 1];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every format's payload is an object; the format-specific keys arrive with their rounds (bracket: `advance`, meet: `mark`). */
function objectPayload(_format: CompetitionFormat, payload: unknown): PayloadCheck {
  return isRecord(payload) ? { ok: true } : { ok: false, error: 'payload must be an object' };
}

const teamSport = (sportKey: string, defaultRule: 'points_2_1_0' | 'points_3_1_0', teamScoreStat: string): CompetitionProfile => ({
  sportKey,
  formats: {
    // Track 2 PR 6 (219): an ad-hoc side — a named team of rostered players — enters a fixture or a bracket too.
    fixture: { entrants: ['team', 'ad_hoc_team'], defaultRule, rules: FIXTURE_RULES_ON_OFFER },
    bracket: { entrants: ['team', 'ad_hoc_team'], defaultRule: null, rules: [] },
  },
  teamScoreStat,
  validateResultPayload: objectPayload,
});

/** The relays live HERE, never in `TRACK_EVENTS` (shared with the stat schema and the PB tiles — a relay mark is never a personal stat line). */
export const RELAY_EVENTS: readonly MeetEventDef[] = [
  { key: 'relay_4x100', label: '4×100m relay', unit: 's', direction: 'asc', relay: true, legs: 4 },
  { key: 'relay_4x400', label: '4×400m relay', unit: 's', direction: 'asc', relay: true, legs: 4 },
];
export const MEET_EVENTS_TRACK: readonly MeetEventDef[] = [...TRACK_EVENTS.map(e => ({ key: e.key, label: e.label, unit: 's' as const, direction: 'asc' as const })), ...RELAY_EVENTS];

const PROFILES: Record<string, CompetitionProfile> = {
  ice_hockey: teamSport('ice_hockey', 'points_2_1_0', 'goals'),
  soccer: teamSport('soccer', 'points_3_1_0', 'goals'),
  basketball: teamSport('basketball', 'points_2_1_0', 'points'),
  volleyball: teamSport('volleyball', 'points_3_1_0', 'kills'),
  baseball: teamSport('baseball', 'points_2_1_0', 'runs'),
  golf: {
    sportKey: 'golf',
    formats: {
      leaderboard: { entrants: ['athlete'], defaultRule: 'stroke_total', rules: GOLF_RULES_ON_OFFER },
      // A golf bracket = match play: singles (athlete) or four-ball (an ad-hoc pair, 219).
      bracket: { entrants: ['athlete', 'ad_hoc_team'], defaultRule: null, rules: [] },
    },
    teamScoreStat: null,
    validateResultPayload: objectPayload,
  },
  track_field: {
    sportKey: 'track_field',
    formats: {
      // A meet is a MIXED field: athletes (the default) and relay teams (ad-hoc entries of legs — leftovers PR 3).
      meet: { entrants: ['athlete', 'ad_hoc_team'], defaultRule: null, rules: [] },
    },
    meetEvents: MEET_EVENTS_TRACK,
    defaultMeetPoints: DEFAULT_MEET_POINTS,
    teamScoreStat: null,
    validateResultPayload: objectPayload,
  },
};

/** A sport with no profile keeps yesterday's behaviour: a team fixture on 2-1-0, an athlete leaderboard on points. */
export const DEFAULT_PROFILE: CompetitionProfile = {
  sportKey: 'default',
  formats: {
    fixture: { entrants: ['team'], defaultRule: 'points_2_1_0', rules: FIXTURE_RULES_ON_OFFER },
    leaderboard: { entrants: ['athlete'], defaultRule: 'points_total', rules: ['points_total'] },
  },
  teamScoreStat: null,
  validateResultPayload: objectPayload,
};

export const PROFILED_SPORTS = Object.keys(PROFILES) as readonly string[];

export function resolveCompetitionProfile(sportKey: string | null | undefined): CompetitionProfile {
  return (sportKey && PROFILES[sportKey]) || DEFAULT_PROFILE;
}

/** The default scoring rule for a sport × format; null when the format computes without one or the profile lacks the format. */
export function defaultRuleFor(profile: CompetitionProfile, format: CompetitionFormat): string | null {
  return profile.formats[format]?.defaultRule ?? null;
}

/** The entrant kind a competition takes when the organizer names none — the format's first; null when the sport lacks the format. */
export function defaultEntrantFor(profile: CompetitionProfile, format: CompetitionFormat): EntrantKind | null {
  return profile.formats[format]?.entrants[0] ?? null;
}

export type FormatEntrantRefusal = 'format_unsupported' | 'entrant_unsupported';

/** Why a sport × format × entrant may not be created; null = fine. */
export function formatEntrantRefusal(profile: CompetitionProfile, format: CompetitionFormat, entrant: EntrantKind | null | undefined): FormatEntrantRefusal | null {
  const f = profile.formats[format];
  if (!f) return 'format_unsupported';
  if (entrant && !f.entrants.includes(entrant)) return 'entrant_unsupported';
  return null;
}

export const FORMAT_ENTRANT_REFUSAL_COPY: Readonly<Record<FormatEntrantRefusal, string>> = {
  format_unsupported: 'This sport does not run that competition format.',
  entrant_unsupported: 'That entrant kind does not fit this sport and format.',
};
