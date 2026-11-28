// ── The golf round setup as steps (Oct 28 2026) — pure, zero imports ───────
// Tom: the one long round form becomes a step-by-step flow; every input and
// behaviour stays, only the way through them changes. The step LIST depends
// on the first step's answers (the org wizard's `stepsFor` idea):
//   • Indoor drops Conditions (the form hid them for indoor already).
//     Its course step picks a tee and a putting rule (Nov 27 2026).
//   • A LIVE round enters no scores here (Nov 24 2026, Tom): it is scored
//     on its live page. This reversed Oct 31 2026 (Scores on every round).
//   • An ALREADY-PLAYED round (rebuilt Nov 27 2026, Tom: "similar to what
//     we had before", following the live round) adds a Scores step after
//     Players: the live scoring card, in its batch mode, for every player.
//     It needs at least one scored hole: a finished round without scores
//     draws no scorecard.
//   • Already played finishes on "Create" — the round lands on the draft
//     review; Live finishes on "Start" — Go Live.
// Playing now + Outdoor are the defaults (Tom, Oct 28: keep today's), the
// date is locked to today while Playing now (the old past-date → Already
// played flip is retired), and only the course step can refuse Next:
// course + date were the ONLY required fields of the form and still are.
// StepFlow draws the frame; this module decides the list and the refusals.

export type RoundStepId = 'type' | 'course' | 'format' | 'conditions' | 'players' | 'scores' | 'finish';

export interface RoundStep {
  id: RoundStepId;
  label: string;
  /** Skip is offered: nothing on this step was ever required. */
  skippable?: boolean;
}

export interface RoundStepAnswers {
  alreadyPlayed: boolean;
  indoor: boolean;
}

// ── "Already played" is offered, and its steps are built (Nov 27 2026) ──────
// History: hidden on Nov 25 2026, because with the Scores step gone a round
// logged as already played would be created with no scores and no door to
// add them (a finished round without scores draws no scorecard).
// Tom, Nov 27 2026: step 1 asks Live / Already played again, beside Outdoor /
// Indoor, for both round types, and the played steps are built: the same
// steps as live, a date on the course step, a Scores step, Create. The live
// path is unchanged. Either flag set back to false closes the played path
// again without touching live: `OFFERED` hides the key, `STEPS_BUILT` holds
// the path on step 1 (`REFUSAL_PLAYED_STEPS`) and brings a saved played
// draft back as a live round.
export const ALREADY_PLAYED_OFFERED = true;
/** The already-played steps exist. While false, step 1 refuses Next for an
 *  already-played round and a restored already-played draft comes back live. */
export const ALREADY_PLAYED_STEPS_BUILT = true;

/** The mode a round may be RESTORED in: an already-played answer in a saved
 *  draft is a live round until the mode is offered and its steps are built. */
export function offeredAlreadyPlayed(
  alreadyPlayed: boolean | undefined,
  offered: boolean = ALREADY_PLAYED_OFFERED && ALREADY_PLAYED_STEPS_BUILT,
): boolean {
  return offered && alreadyPlayed === true;
}

/** The first step's defaults — today's form opened the same way. */
export const DEFAULT_ROUND_ANSWERS: RoundStepAnswers = { alreadyPlayed: false, indoor: false };

export const FIRST_ROUND_STEP: RoundStepId = 'type';

/** The steps a round walks, from the first step's answers. */
export function stepsForRound(a: RoundStepAnswers): RoundStep[] {
  const steps: RoundStep[] = [
    { id: 'type', label: 'Round type' },
    { id: 'course', label: 'Course' },
    { id: 'format', label: 'Game format' },
  ];
  if (!a.indoor) steps.push({ id: 'conditions', label: 'Conditions', skippable: true });
  steps.push({ id: 'players', label: 'Players', skippable: true });
  // An already-played round's scores (Nov 27 2026). Never skippable: the
  // round is created finished, and a finished round needs a score.
  if (a.alreadyPlayed) steps.push({ id: 'scores', label: 'Scores' });
  steps.push({ id: 'finish', label: a.alreadyPlayed ? 'Create' : 'Start' });
  return steps;
}

/** Where a step sits in the list; 0 (the first step) when the list does not
 *  hold it — a draft saved on a step its list lacks (a live round has no
 *  Scores step) starts over rather than rendering nothing. */
export function roundStepIndex(steps: RoundStep[], id: RoundStepId | string | undefined): number {
  const i = steps.findIndex(s => s.id === id);
  return i < 0 ? 0 : i;
}

export interface RoundStepFacts {
  courseName: string;
  date: string;
  alreadyPlayed: boolean;
  /** An indoor round's course step also waits for a tee (Nov 27 2026). */
  indoor?: boolean;
  teeColor?: string;
  /** The picked (or hand-added) course is on screen — the tee list with it. */
  courseShown?: boolean;
  /** At least one hole has strokes on someone's card (an already-played
   *  round's Scores step and its Create). */
  scoresEntered?: boolean;
  /** The viewer's own day (YYYY-MM-DD): an already-played round is never
   *  dated after it. Absent = not checked. */
  today?: string;
}

export const REFUSAL_COURSE = 'Pick or type a course first';
export const REFUSAL_DATE = 'Pick the date you played';
/** A typed date after today (the picker's own `max` stops a picked one). */
export const REFUSAL_DATE_FUTURE = 'The date cannot be after today';
export const REFUSAL_TEE = 'Pick a tee first';
/** Indoor, a name typed but not yet added: the tee list is one tap away. */
export const REFUSAL_COURSE_ADD = 'Pick a course, or add the one you typed';
/** Step 1, Already played picked while its steps are switched off. */
export const REFUSAL_PLAYED_STEPS = 'Already played is not ready yet';
/** An already-played round with no hole scored yet (Nov 27 2026). */
export const REFUSAL_SCORES = 'Enter at least one hole first';

/** Why Next (or the finish) is refused on a step; null means go ahead.
 *  The course step and the finish refuse for the two fields the form always
 *  required, and — on an INDOOR round's course step (Tom's indoor course
 *  spec, Nov 27 2026) — until a tee is picked. The finish never asks for the
 *  tee: a draft saved before the rule still starts. Step 1 refuses an
 *  already-played round while its steps are switched off. An already-played
 *  round's Scores step and its Create wait for one scored hole. A live
 *  round meets none of the already-played rules. */
export function roundStepRefusal(
  id: RoundStepId,
  facts: RoundStepFacts,
  playedStepsBuilt: boolean = ALREADY_PLAYED_STEPS_BUILT,
): string | null {
  if (id === 'type') return facts.alreadyPlayed && !playedStepsBuilt ? REFUSAL_PLAYED_STEPS : null;
  if (id === 'scores') return facts.alreadyPlayed && !facts.scoresEntered ? REFUSAL_SCORES : null;
  if (id !== 'course' && id !== 'finish') return null;
  if (facts.courseName.trim().length === 0) return REFUSAL_COURSE;
  if (facts.alreadyPlayed && !facts.date) return REFUSAL_DATE;
  if (facts.alreadyPlayed && facts.today && facts.date > facts.today) return REFUSAL_DATE_FUTURE;
  if (id === 'course' && facts.indoor && !(facts.teeColor ?? '').trim()) {
    return facts.courseShown === false ? REFUSAL_COURSE_ADD : REFUSAL_TEE;
  }
  if (id === 'finish' && facts.alreadyPlayed && !facts.scoresEntered) return REFUSAL_SCORES;
  return null;
}

export const PLAYED_DATE_INVALID = 'An already-played round needs the date it was played, not after today';

/** The server's own check on an already-played round's date (the client's
 *  is `REFUSAL_DATE_FUTURE`): a real YYYY-MM-DD day, not after today. The
 *  server does not know the viewer's time zone, so "today" is the latest
 *  day it is anywhere on Earth (UTC+14). */
export function playedDateAllowed(date: unknown, now: Date): boolean {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return false;
  const latestToday = new Date(now.getTime() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return date <= latestToday;
}

/** The round's date for its mode: a live round is always today; an
 *  already-played round keeps whatever the person picked (today by default). */
export function roundDateForMode(alreadyPlayed: boolean, picked: string, today: string): string {
  return alreadyPlayed ? picked : today;
}

/** The finish button: red Go Live for a live round, the brand Create Post
 *  for an already-played one — the two labels the one-page form used. */
export function roundFinishLabel(alreadyPlayed: boolean): string {
  return alreadyPlayed ? 'Create Post' : 'Go Live';
}

export function roundBusyLabel(alreadyPlayed: boolean): string {
  return alreadyPlayed ? 'Creating...' : 'Starting…';
}

// ── The live + outdoor path's numbering (Oct 29 2026) ───────────────────────
// Tom's refinement spec numbers the screens 1–6 as a person starting a live
// outdoor round sees them, and asks that code, tests and later specs keep
// the numbering. This is that list: `stepsForRound(DEFAULT_ROUND_ANSWERS)`
// in order — Step 1 Round type · 2 Course · 3 Game format · 4 Conditions ·
// 5 Players · 6 Start (Nov 24 2026: six again, the Scores step is gone).
// `round-steps.test.ts` pins the two agree.
export const LIVE_OUTDOOR_STEPS: readonly RoundStepId[] = ['type', 'course', 'format', 'conditions', 'players', 'finish'];

/** The step's number on the live + outdoor path (1-based); 0 when it is not on it. */
export function liveOutdoorStepNumber(id: RoundStepId): number {
  return LIVE_OUTDOOR_STEPS.indexOf(id) + 1;
}

// ── The conditions as one line (step 6) ─────────────────────────────────────
// Tom, Oct 29 2026: ONE line, without "Forecasted at tee-off" (the
// Conditions step's note, the round card and the round page keep theirs).
// Tom, Nov 24 2026 ("design wording everywhere"): `Sunny · 11 °C · 5 to 10
// mph` — the weather word, the temperature in the viewer's unit with its
// space, the wind band as its mph range written "5 to 10". The Wind
// dropdown's options read the same ranges (`windOptionLabel`).

export const WIND_RANGE: Readonly<Record<string, string>> = {
  calm: '0 to 5 mph',
  light: '5 to 10 mph',
  moderate: '10 to 20 mph',
  strong: '20+ mph',
};

const WIND_WORD: Readonly<Record<string, string>> = {
  calm: 'Calm',
  light: 'Light',
  moderate: 'Moderate',
  strong: 'Strong',
};

/** The Wind dropdown's option: "Light (5 to 10 mph)"; null for an unknown band. */
export function windOptionLabel(value: string): string | null {
  const word = WIND_WORD[value];
  const range = WIND_RANGE[value];
  return word && range ? `${word} (${range})` : null;
}

export function windRange(value: string): string | null {
  return WIND_RANGE[value] ?? null;
}

const WEATHER_WORD: Readonly<Record<string, string>> = {
  sunny: 'Sunny',
  'partly-cloudy': 'Partly cloudy',
  cloudy: 'Cloudy',
  rainy: 'Rainy',
  windy: 'Windy',
};

export function weatherWord(value: string): string | null {
  return WEATHER_WORD[value] ?? null;
}

/** "7 °C" / "45 °F" — a whole number, a space, the unit (the house
 *  `formatQuantity` spelling). */
export function summaryTemperature(value: number, unit: '°C' | '°F'): string {
  return `${Math.round(value)} ${unit}`;
}

/** The one line, from the three stored fields (the temperature already in
 *  the viewer's unit); null when nothing was entered. */
export function conditionsLine(input: { weather: string; temperature: number | null; unit: '°C' | '°F'; wind: string }): string | null {
  const parts = [
    weatherWord(input.weather),
    input.temperature !== null && Number.isFinite(input.temperature) ? summaryTemperature(input.temperature, input.unit) : null,
    windRange(input.wind),
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ── The dialog's width on a desktop (the mechanical dialect, Nov 23 2026) ──
// Tom's visual specs: every step sits in a 480 px dialog, except the course
// step once a course is SHOWN (picked from the catalog, or a typed name
// added by hand): its two columns take 760 px. A phone is full screen either
// way — this only names the frame. (Nov 24 2026: the later steps came back
// to 480 px; they were wide only while a score grid lived among them.)
//
// 'full' (920 px) is the course step with the course's SCORECARD open: an
// eighteen with its tee rows is wider than 760 px, and a wide table on a
// desktop gets a layout that fits — never a hidden sideways scroll (the
// Oct 30 2026 rule).
export type RoundFrame = 'narrow' | 'wide' | 'full';

export function roundFrame(stepId: RoundStepId, courseShown: boolean, scorecardOpen = false): RoundFrame {
  if (stepId === 'course' && courseShown) return scorecardOpen ? 'full' : 'wide';
  return 'narrow';
}
