/**
 * The creation wizard's rules (Events program, the wizard) — pure. Four
 * steps, one validator per step (the copy is the refusal the user reads),
 * and the body the POST takes. The wizard component is the I/O. Phase 2:
 * the round step is a LIST of rounds (`rounds: RoundDraft[]`, 1..MAX_ROUNDS,
 * date order — the create route's rule) and "Add a round" copies the
 * previous round's course, tees and holes with an empty date.
 */
import type { CourseHole } from '@/types/golf';
import { NAME_MAX, DESCRIPTION_MAX, defaultJoinMode, isDateOnly } from './validate';
import { MAX_ROUNDS } from './rounds';
import { isMatchFormat, type MatchSides, type SportEventFormat, type SportEventJoinMode, type SportEventVisibility } from './types';
import { selfEntryFor, type RecordingMode } from './recording';
import { DEFAULT_SIDE_NAMES, parseGameConfig } from './format-config';
import type { SportEventShape, SportEventSport } from './types';

export const WIZARD_STEPS = ['basics', 'round', 'format', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const WIZARD_STEP_LABEL: Readonly<Record<WizardStep, string>> = {
  basics: 'Basics',
  round: 'Round',
  format: 'Format',
  review: 'Review',
};

export interface WizardCourse {
  id: string | null;
  name: string;
  /** Tee names the catalog rates (free text keys). */
  tees: string[];
  holesCount: number | null;
}

/** One round as the round fields edit it (the wizard's step, the event page's add / edit window). */
export interface RoundDraft {
  scheduled_on: string;
  /** 207 — an optional label ("Saturday", "Final round"). */
  name: string;
  course: WizardCourse | null;
  tee: string;
  holes: 9 | 18;
  starting_hole: 1 | 10;
  /** Phase 4 — a team round: the PLACE (the rink, the field; stored as `course_name`) and the start time (HH:MM, optional). */
  place: string;
  starts_at: string;
}

export function emptyRoundDraft(): RoundDraft {
  return { scheduled_on: '', name: '', course: null, tee: '', holes: 18, starting_hole: 1, place: '', starts_at: '' };
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A team round's start: the organizer's date + HH:MM on THEIR clock → ISO (null when blank / malformed). */
export function localStartIso(dateOnly: string, time: string): string | null {
  const t = time.trim();
  if (!TIME_RE.test(t) || !isDateOnly(dateOnly)) return null;
  const d = new Date(`${dateOnly}T${t}:00`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** The inverse for the edit window: an ISO start → HH:MM on this clock ('' when none). */
export function localTimeOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** A stored round → a draft for the edit window (the catalog's tees are not on the row: the tee stays free text). */
export function roundDraftFrom(round: { scheduled_on: string; name?: string | null; course_id: string | null; course_name: string; tee: string | null; holes: number; starting_hole: number; starts_at?: string | null }): RoundDraft {
  return {
    scheduled_on: round.scheduled_on,
    name: round.name ?? '',
    course: { id: round.course_id, name: round.course_name, tees: [], holesCount: null },
    tee: round.tee ?? '',
    holes: round.holes === 9 ? 9 : 18,
    starting_hole: round.holes === 9 && round.starting_hole === 10 ? 10 : 1,
    place: round.course_name,
    starts_at: localTimeOf(round.starts_at),
  };
}

/** The first refusal on a round draft, or null. A team sport's round needs a place (and a well-formed time when given), never a course. */
export function validateRoundDraft(d: RoundDraft, sport: SportEventSport = 'golf'): string | null {
  if (!isDateOnly(d.scheduled_on)) return 'Pick the date.';
  if (sport !== 'golf') {
    if (!d.place.trim()) return 'Where is it? Name the rink, field or court.';
    if (d.starts_at.trim() && !TIME_RE.test(d.starts_at.trim())) return 'The start time is HH:MM.';
    return null;
  }
  if (!d.course || !d.course.name.trim()) return 'Pick a course, or type its name.';
  if (d.holes === 18 && d.starting_hole === 10) return 'An 18-hole round starts on hole 1.';
  return null;
}

/** The round body the routes take (parseRoundInput's shape). A team round sends the place as `course_name` and its start time; no course, no holes. */
export function roundBodyFrom(d: RoundDraft, sport: SportEventSport = 'golf') {
  if (sport !== 'golf') {
    return { scheduled_on: d.scheduled_on, name: d.name.trim() || null, course_name: d.place.trim(), starts_at: localStartIso(d.scheduled_on, d.starts_at) };
  }
  return {
    scheduled_on: d.scheduled_on,
    name: d.name.trim() || null,
    course_id: d.course?.id ?? null,
    course_name: d.course?.name.trim() ?? null,
    tee: d.tee.trim() || null,
    holes: d.holes,
    starting_hole: d.holes === 9 ? d.starting_hole : 1,
  };
}

export interface WizardState {
  name: string;
  description: string;
  visibility: SportEventVisibility;
  join_mode: SportEventJoinMode;
  org: { kind: 'club' | 'league'; id: string } | null;
  /** Phase 2b: the org's competition the event counts toward (only with an org). */
  competition: string | null;
  /** The rounds in order (1..MAX_ROUNDS); a tournament is more than one. */
  rounds: RoundDraft[];
  format: SportEventFormat;
  /** Phase 3: the match shape — read only when `format` is a match format. */
  match: { sides: MatchSides; bracket: boolean };
  capacity: string;
  host_plays: boolean;
  /** Phase 4: who enters the scores — the one stored fact is `self_entry` (`selfEntryFor`). */
  recording: RecordingMode;
  /** Phase 4: the sport (golf, or a stat-line sport) and its shape — a team sport is a game or a session. */
  sport_key: SportEventSport;
  shape: SportEventShape;
  /** Phase 4: a game's two sides. */
  side_names: [string, string];
}

export function emptyWizardState(): WizardState {
  // Phase 4: a new event is PUBLIC and open to join unless the organizer closes it.
  return { name: '', description: '', visibility: 'public', join_mode: 'open', org: null, competition: null, rounds: [emptyRoundDraft()], format: 'stroke_gross', match: { sides: 'singles', bracket: false }, capacity: '', host_plays: true, recording: 'self', sport_key: 'golf', shape: 'round', side_names: [DEFAULT_SIDE_NAMES[0], DEFAULT_SIDE_NAMES[1]] };
}

/** Phase 4: switching the sport resets the shape (golf is a round; a team sport keeps game | session, defaulting to a game) and the golf vocabulary (format, match, competition). */
export function withSport(s: WizardState, sport: SportEventSport): WizardState {
  if (sport === s.sport_key) return s;
  const shape: SportEventShape = sport === 'golf' ? 'round' : s.shape === 'session' ? 'session' : 'game';
  return { ...s, sport_key: sport, shape, format: 'stroke_gross', match: { sides: 'singles', bracket: false }, competition: null };
}

/** A visibility pick re-seats the joining choice — open for public, invite otherwise — unless the organizer touched joining themselves. */
export function withVisibility(s: WizardState, visibility: SportEventVisibility, joinTouched: boolean): WizardState {
  return { ...s, visibility, join_mode: joinTouched ? s.join_mode : defaultJoinMode(visibility) };
}

function isRoundDirty(r: RoundDraft): boolean {
  const e = emptyRoundDraft();
  return r.scheduled_on !== e.scheduled_on || r.name !== '' || r.course !== null || r.tee !== '' || r.holes !== e.holes || r.starting_hole !== e.starting_hole;
}

export function isWizardDirty(s: WizardState): boolean {
  const e = emptyWizardState();
  return s.name !== e.name || s.description !== e.description || s.rounds.length !== 1 || s.rounds.some(isRoundDirty) || s.capacity !== '' || s.visibility !== e.visibility || s.join_mode !== e.join_mode || s.org !== null || s.competition !== null || s.format !== e.format || s.match.sides !== e.match.sides || s.match.bracket !== e.match.bracket || s.host_plays !== e.host_plays || s.recording !== e.recording || s.sport_key !== e.sport_key || s.shape !== e.shape || s.side_names[0] !== e.side_names[0] || s.side_names[1] !== e.side_names[1];
}

/** "Add a round": the previous round's course, tees and holes with an empty date (36 holes in a weekend is the common case). Refused at MAX_ROUNDS. */
export function addWizardRound(s: WizardState): WizardState {
  if (s.rounds.length >= MAX_ROUNDS) return s;
  const prev = s.rounds[s.rounds.length - 1] ?? emptyRoundDraft();
  return { ...s, rounds: [...s.rounds, { ...prev, scheduled_on: '', name: '' }] };
}

/** Remove a round from the list (never the first — an event needs a round). */
export function removeWizardRound(s: WizardState, index: number): WizardState {
  if (index <= 0 || index >= s.rounds.length) return s;
  return { ...s, rounds: s.rounds.filter((_, i) => i !== index) };
}

export function updateWizardRound(s: WizardState, index: number, patch: Partial<RoundDraft>): WizardState {
  return { ...s, rounds: s.rounds.map((r, i) => (i === index ? { ...r, ...patch } : r)) };
}

/** The first refusal across the rounds: a round's own miss ("Round 2: Pick the date.") or the date order. */
export function validateWizardRounds(rounds: RoundDraft[], sport: SportEventSport = 'golf'): string | null {
  if (rounds.length === 0) return 'Add a round.';
  const many = rounds.length > 1;
  for (let i = 0; i < rounds.length; i++) {
    const r = validateRoundDraft(rounds[i], sport);
    if (r) return many ? `Round ${i + 1}: ${r}` : r;
    if (i > 0 && rounds[i].scheduled_on < rounds[i - 1].scheduled_on) return `Round ${i + 1} must not be before round ${i}.`;
  }
  return null;
}

/** The first refusal on a step, or null when it may advance. */
export function validateWizardStep(step: WizardStep, s: WizardState): string | null {
  switch (step) {
    case 'basics': {
      const name = s.name.trim();
      if (!name) return 'Give the event a name.';
      if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
      if (s.description.length > DESCRIPTION_MAX) return `Keep the description under ${DESCRIPTION_MAX} characters.`;
      return null;
    }
    case 'round':
      return validateWizardRounds(s.rounds, s.sport_key);
    case 'format': {
      if (s.sport_key !== 'golf') {
        if (s.shape === 'game') {
          const g = parseGameConfig({ side_names: s.side_names });
          if (!g.ok) return g.error.includes('differ') ? 'Give the two sides different names.' : 'Name both sides (up to 40 characters each).';
        }
        if (s.capacity.trim() !== '') {
          const n = Number(s.capacity);
          if (!Number.isInteger(n) || n < 1 || n > 500) return 'Field size is a whole number from 1 to 500, or blank.';
        }
        return null;
      }
      if (isMatchFormat(s.format) && s.competition) return 'A match-play event cannot count toward a competition — pick stroke play, or clear the competition.';
      if (isMatchFormat(s.format) && s.match.bracket && s.rounds.length < 2) return 'A bracket needs at least two rounds — add the rounds it plays over.';
      if (s.capacity.trim() !== '') {
        const n = Number(s.capacity);
        if (!Number.isInteger(n) || n < 1 || n > 500) return 'Field size is a whole number from 1 to 500, or blank.';
      }
      return null;
    }
    case 'review':
      return validateWizardStep('basics', s) ?? validateWizardStep('round', s) ?? validateWizardStep('format', s);
  }
}

/** The POST body (parseCreateBody's shape). `publish` = the review's Publish; false = Save draft. */
export function wizardToCreateBody(s: WizardState, opts: { publish: boolean; profileId: string | null }) {
  return {
    name: s.name.trim(),
    description: s.description.trim() || null,
    sport_key: s.sport_key,
    // A team sport sends its shape; golf stays phase 1's body (the route reads a missing shape as `round`).
    ...(s.sport_key !== 'golf' ? { shape: s.shape } : {}),
    visibility: s.visibility,
    join_mode: s.join_mode,
    format: s.format,
    capacity: s.capacity.trim() === '' ? null : Number(s.capacity),
    club_id: s.org?.kind === 'club' ? s.org.id : null,
    league_id: s.org?.kind === 'league' ? s.org.id : null,
    competition_id: s.org ? s.competition : null,
    ...(s.sport_key === 'golf' && isMatchFormat(s.format) ? { format_config: { match: { sides: s.match.sides, bracket: s.match.bracket } } } : {}),
    ...(s.sport_key !== 'golf' && s.shape === 'game' ? { format_config: { game: { side_names: [s.side_names[0].trim(), s.side_names[1].trim()] } } } : {}),
    host_plays: s.host_plays,
    self_entry: selfEntryFor(s.recording),
    publish: opts.publish,
    profile_id: opts.profileId,
    // One round keeps phase 1's body; a tournament sends the list (the route accepts either, never both).
    ...(s.rounds.length === 1 ? { round: roundBodyFrom(s.rounds[0], s.sport_key) } : { rounds: s.rounds.map(r => roundBodyFrom(r, s.sport_key)) }),
  };
}

/** A catalog course → the wizard's course (its tees from the rating keys, then the yardage keys). */
export function wizardCourseFrom(course: { id: string; name: string; courseRating?: Record<string, number>; slopeRating?: Record<string, number>; holes?: CourseHole[]; holesCount?: number }): WizardCourse {
  const tees = new Set<string>([...Object.keys(course.courseRating ?? {}), ...Object.keys(course.slopeRating ?? {})]);
  if (tees.size === 0) for (const h of course.holes ?? []) for (const k of Object.keys(h.yardage ?? {})) tees.add(k);
  return { id: course.id, name: course.name, tees: [...tees], holesCount: course.holesCount ?? (course.holes && course.holes.length > 0 ? course.holes.length : null) };
}
