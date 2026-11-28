// ── The golf round setup as steps (Oct 28 2026) — pure, zero imports ───────
// Tom: the one long round form becomes a step-by-step flow; every input and
// behaviour stays, only the way through them changes. The step LIST depends
// on the first step's answers (the org wizard's `stepsFor` idea):
//   • Indoor drops Conditions (the form hid them for indoor already).
//     Its course step picks a tee and a putting rule (Nov 27 2026).
//   • No round enters scores here (Nov 24 2026, Tom: the flow is about
//     starting a live round; the already-played process is rebuilt later).
//     A live round is scored on its live page. This reverses Oct 31 2026
//     (Scores on every round). Nov 27 2026: Already played is a key on step
//     1 again and stops there until its own steps are built.
//   • Already played finishes on "Create" — the round lands on the draft
//     review; Playing now finishes on "Start" — Go Live.
// Playing now + Outdoor are the defaults (Tom, Oct 28: keep today's), the
// date is locked to today while Playing now (the old past-date → Already
// played flip is retired), and only the course step can refuse Next:
// course + date were the ONLY required fields of the form and still are.
// StepFlow draws the frame; this module decides the list and the refusals.

export type RoundStepId = 'type' | 'course' | 'format' | 'conditions' | 'players' | 'finish';

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

// ── "Already played" is offered again; its steps are not built (Nov 27 2026) ─
// History: hidden on Nov 25 2026, because with the Scores step gone a round
// logged as already played would be created with no scores and no door to
// add them (a finished round without scores draws no scorecard).
// Tom, Nov 27 2026: step 1 asks Live / Already played again, beside Outdoor /
// Indoor, for both round types; the already-played steps are designed with
// him next. Until they are built the played path STOPS on step 1
// (`REFUSAL_PLAYED_STEPS`), so no finished round without scores can be
// created here. The live path is unchanged. The mode's older rules and paths
// below stay for the rebuild.
export const ALREADY_PLAYED_OFFERED = true;
/** The already-played steps exist. While false, step 1 refuses Next for an
 *  already-played round and a restored already-played draft comes back live. */
export const ALREADY_PLAYED_STEPS_BUILT = false;

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
  steps.push({ id: 'finish', label: a.alreadyPlayed ? 'Create' : 'Start' });
  return steps;
}

/** Where a step sits in the list; 0 (the first step) when the list no longer
 *  holds it — a draft saved on a step that has since left the list (the
 *  retired Scores step) starts over rather than rendering nothing. */
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
}

export const REFUSAL_COURSE = 'Pick or type a course first';
export const REFUSAL_DATE = 'Pick the date you played';
export const REFUSAL_TEE = 'Pick a tee first';
/** Indoor, a name typed but not yet added: the tee list is one tap away. */
export const REFUSAL_COURSE_ADD = 'Pick a course, or add the one you typed';
/** Step 1, Already played picked before its steps exist (Nov 27 2026). */
export const REFUSAL_PLAYED_STEPS = 'Already played is not ready yet';

/** Why Next (or the finish) is refused on a step; null means go ahead.
 *  The course step and the finish refuse for the two fields the form always
 *  required, and — on an INDOOR round's course step (Tom's indoor course
 *  spec, Nov 27 2026) — until a tee is picked. The finish never asks for the
 *  tee: a draft saved before the rule still starts. Step 1 refuses an
 *  already-played round while its steps are not built; a live round never
 *  meets that rule. */
export function roundStepRefusal(
  id: RoundStepId,
  facts: RoundStepFacts,
  playedStepsBuilt: boolean = ALREADY_PLAYED_STEPS_BUILT,
): string | null {
  if (id === 'type') return facts.alreadyPlayed && !playedStepsBuilt ? REFUSAL_PLAYED_STEPS : null;
  if (id !== 'course' && id !== 'finish') return null;
  if (facts.courseName.trim().length === 0) return REFUSAL_COURSE;
  if (facts.alreadyPlayed && !facts.date) return REFUSAL_DATE;
  if (id === 'course' && facts.indoor && !(facts.teeColor ?? '').trim()) {
    return facts.courseShown === false ? REFUSAL_COURSE_ADD : REFUSAL_TEE;
  }
  return null;
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
