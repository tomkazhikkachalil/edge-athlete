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
