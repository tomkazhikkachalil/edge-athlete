// ── The golf round setup as steps (Oct 28 2026) — pure, zero imports ───────
// Tom: the one long round form becomes a step-by-step flow; every input and
// behaviour stays, only the way through them changes. The step LIST depends
// on the first step's answers (the org wizard's `stepsFor` idea):
//   • Indoor drops Conditions (the form hid them for indoor already).
//   • Already played adds Scores (the grid + the hole-by-hole Quick entry)
//     and the finish is "Create" — the round lands on the draft review;
//     Playing now has no scores step (they are entered on the live page)
//     and the finish is "Start" — Go Live.
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
  if (a.alreadyPlayed) steps.push({ id: 'scores', label: 'Scores', skippable: true });
  steps.push({ id: 'finish', label: a.alreadyPlayed ? 'Create' : 'Start' });
  return steps;
}

/** Where a step sits in the list; 0 (the first step) when the list no longer
 *  holds it — a restored draft on Scores after switching to Playing now
 *  starts over rather than rendering a step that does not exist. */
export function roundStepIndex(steps: RoundStep[], id: RoundStepId | string | undefined): number {
  const i = steps.findIndex(s => s.id === id);
  return i < 0 ? 0 : i;
}

export interface RoundStepFacts {
  courseName: string;
  date: string;
  alreadyPlayed: boolean;
}

export const REFUSAL_COURSE = 'Pick or type a course first';
export const REFUSAL_DATE = 'Pick the date you played';

/** Why Next (or the finish) is refused on a step; null means go ahead.
 *  Only the course step and the finish can refuse, and only for the two
 *  fields the form always required. */
export function roundStepRefusal(id: RoundStepId, facts: RoundStepFacts): string | null {
  if (id !== 'course' && id !== 'finish') return null;
  if (facts.courseName.trim().length === 0) return REFUSAL_COURSE;
  if (facts.alreadyPlayed && !facts.date) return REFUSAL_DATE;
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
// 5 Players · 6 Start. `round-steps.test.ts` pins the two agree.
export const LIVE_OUTDOOR_STEPS: readonly RoundStepId[] = ['type', 'course', 'format', 'conditions', 'players', 'finish'];

/** The step's number on the live + outdoor path (1-based); 0 when it is not on it. */
export function liveOutdoorStepNumber(id: RoundStepId): number {
  return LIVE_OUTDOOR_STEPS.indexOf(id) + 1;
}

// ── The conditions as one line (step 6, Oct 29 2026) ────────────────────────
// Tom: shorten the summary to `Cloudy, 7°C, 5–10 mph` and drop "Forecasted
// at tee-off" from it (the Conditions step's note, the round card and the
// round page keep theirs). The weather word without its emoji, the
// temperature in the viewer's unit written tight, the wind band as its mph
// range — the select's own ranges, an en dash.

export const WIND_RANGE: Readonly<Record<string, string>> = {
  calm: '0–5 mph',
  light: '5–10 mph',
  moderate: '10–20 mph',
  strong: '20+ mph',
};

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

/** "7°C" / "45°F" — the summary's tight spelling (the house `formatQuantity`
 *  keeps "7 °C" everywhere else). */
export function tightTemperature(value: number, unit: '°C' | '°F'): string {
  return `${Math.round(value)}${unit}`;
}

/** The one line, from the three stored fields (the temperature already in
 *  the viewer's unit); null when nothing was entered. */
export function conditionsLine(input: { weather: string; temperature: number | null; unit: '°C' | '°F'; wind: string }): string | null {
  const parts = [
    weatherWord(input.weather),
    input.temperature !== null && Number.isFinite(input.temperature) ? tightTemperature(input.temperature, input.unit) : null,
    windRange(input.wind),
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(', ') : null;
}
