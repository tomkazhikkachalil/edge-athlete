/**
 * Sport events — the row shapes and literal vocabularies (Events program,
 * phase 1 — Sep 16 2026). The database (migrations 201–206) is the source
 * of truth; every union here mirrors a CHECK constraint by name so a
 * widened CHECK is a one-line change on both sides.
 *
 * Naming: `sport_events` in the database, API and code; "Events" on every
 * screen (the calendar owns the word `events`). An Event is organizer
 * intent — draft → open → live → completed — layered over a live round:
 * each round IS one `group_posts` row, minted at go-live and linked by
 * `group_posts.sport_event_round_id` (203). See docs/EVENTS.md.
 */

export const SPORT_EVENT_STATUSES = ['draft', 'open', 'live', 'completed', 'cancelled'] as const;
export type SportEventStatus = (typeof SPORT_EVENT_STATUSES)[number];

export const SPORT_EVENT_VISIBILITIES = ['public', 'link', 'private'] as const;
export type SportEventVisibility = (typeof SPORT_EVENT_VISIBILITIES)[number];

/** Phase 4 (214): `open` — one-tap Join for any signed-in person; capacity and the waitlist still apply. */
export const SPORT_EVENT_JOIN_MODES = ['invite', 'request', 'open'] as const;
export type SportEventJoinMode = (typeof SPORT_EVENT_JOIN_MODES)[number];

/** Phase 3 (212): match play joins stroke play; the CHECK `sport_events_format_check` carries the four. */
/** Leftovers (221 RAN): the six formats — Stableford in both flavours joined the parsers' list in PR 10, after the CHECK widened. */
export const SPORT_EVENT_FORMATS_ALL = ['stroke_gross', 'stroke_net', 'match_gross', 'match_net', 'stableford_gross', 'stableford_net'] as const;
export const SPORT_EVENT_FORMATS = SPORT_EVENT_FORMATS_ALL;
export type SportEventFormat = (typeof SPORT_EVENT_FORMATS_ALL)[number];
export const isMatchFormat = (format: string | null | undefined): boolean => format === 'match_gross' || format === 'match_net';
export const isStablefordFormat = (format: string | null | undefined): boolean => format === 'stableford_gross' || format === 'stableford_net';
export const isNetFormat = (format: string | null | undefined): boolean => format === 'stroke_net' || format === 'match_net' || format === 'stableford_net';
/** Which way a better score points: strokes ascend, Stableford points descend. */
export const scoreDirection = (format: string | null | undefined): 'asc' | 'desc' => (isStablefordFormat(format) ? 'desc' : 'asc');

export const SPORT_EVENT_ROUND_STATUSES = ['scheduled', 'live', 'completed', 'cancelled'] as const;
export type SportEventRoundStatus = (typeof SPORT_EVENT_ROUND_STATUSES)[number];

export const SPORT_EVENT_ROLES = ['organizer', 'co_organizer', 'participant', 'follower'] as const;
export type SportEventRole = (typeof SPORT_EVENT_ROLES)[number];

export const SPORT_EVENT_PARTICIPANT_STATUSES = ['invited', 'requested', 'accepted', 'declined', 'removed', 'withdrawn', 'waitlisted'] as const;
export type SportEventParticipantStatus = (typeof SPORT_EVENT_PARTICIPANT_STATUSES)[number];

export const HANDICAP_SOURCES = ['computed', 'organizer', 'none'] as const;
export type HandicapSource = (typeof HANDICAP_SOURCES)[number];

/**
 * The sports an event may be created for — the create parser's list. Phase 4
 * widens it to `SPORT_EVENT_SPORTS_ALL` in the PR after migration 215 ran
 * (the `shape` column + its CHECK): a team event created before 215 would
 * violate `(sport_key = 'golf') = (shape = 'round')` when it runs.
 */
export const SPORT_EVENT_SPORTS = ['golf'] as const;
/** Phase 4: the stat-line sports (each has a `STAT_SCHEMAS` entry) — a game or a session with LIVE per-player stats. `track_field` is a meet, not a game (parked: track 2). */
export const SPORT_EVENT_STAT_SPORTS = ['ice_hockey', 'basketball', 'soccer', 'baseball', 'volleyball'] as const;
export type SportEventStatSport = (typeof SPORT_EVENT_STAT_SPORTS)[number];
export const SPORT_EVENT_SPORTS_ALL = ['golf', ...SPORT_EVENT_STAT_SPORTS] as const;
export type SportEventSport = (typeof SPORT_EVENT_SPORTS_ALL)[number];
export const isStatSport = (sportKey: string | null | undefined): sportKey is SportEventStatSport => (SPORT_EVENT_STAT_SPORTS as readonly string[]).includes(sportKey ?? '');

/**
 * Phase 4 (215): the SHAPE lives on the event, one decision at creation like
 * `format` — `round` (golf: hole-by-hole cards), `game` (a team sport: the
 * joiners sorted into two ad-hoc sides, a live score + per-player stats) or
 * `session` (a team sport: one roster, per-player stats). The CHECK
 * `(sport_key = 'golf') = (shape = 'round')` holds both ways.
 */
export const SPORT_EVENT_SHAPES = ['round', 'game', 'session'] as const;
export type SportEventShape = (typeof SPORT_EVENT_SHAPES)[number];
export const isStatShape = (shape: string | null | undefined): boolean => shape === 'game' || shape === 'session';
/** The shape a row reads as: the stored one, else golf's `round` (every pre-215 row). */
export const shapeOf = (row: { sport_key: string; shape?: string | null }): SportEventShape => (row.shape === 'game' || row.shape === 'session' ? row.shape : 'round');

/** A round's copy of the course's holes — WITH the stroke index (`handicap`), unlike the shared-round writer of old. */
export interface SportEventHoleDatum {
  hole: number;
  par: number;
  yardage?: number | null;
  handicap?: number | null;
}

/**
 * The organizer's format options (207, `sport_events.format_config` jsonb;
 * validated by format-config.ts parseFormatConfig; ONE writer: PATCH
 * /api/sport-events/[id]). `cut`: after round K, the top N (ties at the
 * nth place all make it) or everyone at or under a to-par. `stableford`
 * is a reserved key (parked).
 */
export interface CutRule {
  after_round: number;
  top_n?: number;
  to_par?: number;
}
/** Phase 3 — match play: the sides of a match and whether the rounds form a knockout bracket. */
export const MATCH_SIDES = ['singles', 'fourball', 'foursomes'] as const;
export type MatchSides = (typeof MATCH_SIDES)[number];
export interface MatchConfig {
  sides: MatchSides;
  bracket: boolean;
  /** The handicap allowance in percent; absent = the WHS default for the sides (100 · 90 · 50). */
  allowance?: number;
}
/** Phase 4 — a game's two ad-hoc sides, named at creation (an org's default teams pre-fill them later). */
export interface GameConfig {
  side_names: [string, string];
  /** Leftovers PR 5: the org teams the sides were pre-filled from (set at creation only). */
  side_team_ids?: [string, string];
}
export interface FormatConfig {
  cut?: CutRule | null;
  /** Phase 3 (212): present on a match format only; `cut` and `match` never coexist. */
  match?: MatchConfig | null;
  /** Phase 4: present on a `game` shape only; never beside `cut` or `match` (golf vocabulary). */
  game?: GameConfig | null;
}

export interface SportEventRow {
  id: string;
  host_profile_id: string;
  created_by_user_id: string | null;
  club_id: string | null;
  league_id: string | null;
  sport_key: string;
  name: string;
  description: string | null;
  cover_path: string | null;
  join_mode: SportEventJoinMode;
  visibility: SportEventVisibility;
  link_token: string | null;
  format: SportEventFormat;
  status: SportEventStatus;
  capacity: number | null;
  /** 207 — optional until PR 8 reads the column (never name it in a select before Tom confirms 207 ran). */
  format_config?: FormatConfig;
  /** 214 (phase 4) — players enter their own; false = recorders / organizers only. Optional until PR 5 read the column. */
  self_entry?: boolean;
  /** 215 (phase 4) — the shape; optional until PR 8 reads the column (`shapeOf` reads a missing one as `round`). */
  shape?: SportEventShape;
  /** 221 (leftovers) — a bracketed MATCH event's org bracket, kept before go-live; optional until the reader PR names the column. */
  competition_id?: string | null;
  starts_on: string | null;
  opened_at: string | null;
  went_live_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SportEventRoundRow {
  id: string;
  sport_event_id: string;
  sequence: number;
  scheduled_on: string;
  course_id: string | null;
  course_name: string;
  tee: string | null;
  holes: 9 | 18;
  starting_hole: 1 | 10;
  course_rating: number | null;
  slope_rating: number | null;
  hole_data: SportEventHoleDatum[] | null;
  status: SportEventRoundStatus;
  /** 207 — an optional label ("Saturday", "Final round"); optional until PR 8 reads the column. */
  name?: string | null;
  /** 215 (phase 4) — a game's start; the live score ON the round; `score_version` is the score write's CAS. Optional until phase 4 PR 8 read them. */
  starts_at?: string | null;
  side1_score?: number | null;
  side2_score?: number | null;
  period?: number | null;
  score_version?: number;
  created_at: string;
  updated_at: string;
}

export interface SportEventParticipantRow {
  id: string;
  sport_event_id: string;
  profile_id: string;
  role: SportEventRole;
  status: SportEventParticipantStatus;
  playing: boolean;
  handicap_index: number | null;
  handicap_source: HandicapSource;
  flight: string | null;
  waitlist_position: number | null;
  hide_from_profile: boolean;
  /** 214 (phase 4) — a named recorder (any accepted row). Optional until PR 5 read the column. */
  recorder?: boolean;
  invited_by: string | null;
  accepted_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SportEventGroupRow {
  id: string;
  sport_event_round_id: string;
  sequence: number;
  name: string | null;
  tee_time: string | null;
  starting_hole: number;
  created_at: string;
  updated_at: string;
}

export interface SportEventGroupMemberRow {
  id: string;
  group_id: string;
  sport_event_round_id: string;
  participant_id: string;
  position: number;
  /** 212 — 1 | 2 on a match-format round; null on a stroke round. Optional until PR 4 reads the column. */
  side?: 1 | 2 | null;
  created_at: string;
}

/** The organizer side of the ladder: who may manage. */
export const MANAGING_ROLES: readonly SportEventRole[] = ['organizer', 'co_organizer'];
export const isManagingRole = (role: SportEventRole | null | undefined): boolean => role === 'organizer' || role === 'co_organizer';

/** Participant statuses that keep a seat or a claim on one. */
export const ACTIVE_PARTICIPANT_STATUSES: readonly SportEventParticipantStatus[] = ['invited', 'requested', 'accepted', 'waitlisted'];
