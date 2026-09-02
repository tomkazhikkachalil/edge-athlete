// ── Golf season generator — N weekly rounds from one declaration (W3) ──────
// Phase 6d W3. An organizer declares the season once (start date, weeks,
// window length, holes, course, label pattern) instead of typing twenty
// rounds by hand. Pure and date-only like golf-weeks.ts: play windows are
// DATE pairs, so week n starts start + 7(n−1) and closes windowDays − 1
// later, with no timezone in sight. The server half (competition-server
// golfSeasonGeneratePOST) dedupes on an existing round's play_from and
// writes through the same contest writer as "Add round".

import { addDaysIso } from './golf-weeks';

export const SEASON_MAX_WEEKS = 52;
export const SEASON_MAX_WINDOW_DAYS = 14;
export const DEFAULT_LABEL_PATTERN = 'Week {n}';
/** contests.round is bounded to 40 characters (ContestCreateSchema). */
export const ROUND_LABEL_MAX = 40;

export interface SeasonRoundSpec {
  round: string;
  playFrom: string;
  playTo: string;
  holes: 9 | 18;
}

export interface GenerateRoundWindowsInput {
  startDate: string;
  weeks: number;
  windowDays: number;
  holes: 9 | 18;
  labelPattern?: string | null;
}

/** "{n}" → the week number; a pattern without it gets " {n}" appended so
 *  two rounds can never share a label by construction. Labels are cut to
 *  the column bound, keeping the number. */
export function roundLabel(pattern: string | null | undefined, n: number): string {
  const base = (pattern ?? '').trim() || DEFAULT_LABEL_PATTERN;
  const withNumber = base.includes('{n}') ? base.replaceAll('{n}', String(n)) : `${base} {n}`.replace('{n}', String(n));
  if (withNumber.length <= ROUND_LABEL_MAX) return withNumber;
  const suffix = ` ${n}`;
  return `${withNumber.slice(0, ROUND_LABEL_MAX - suffix.length).trimEnd()}${suffix}`;
}

export function generateRoundWindows(input: GenerateRoundWindowsInput): SeasonRoundSpec[] {
  const weeks = Math.max(1, Math.min(SEASON_MAX_WEEKS, Math.floor(input.weeks)));
  const windowDays = Math.max(1, Math.min(SEASON_MAX_WINDOW_DAYS, Math.floor(input.windowDays)));
  const out: SeasonRoundSpec[] = [];
  for (let n = 1; n <= weeks; n++) {
    const playFrom = addDaysIso(input.startDate, 7 * (n - 1));
    out.push({
      round: roundLabel(input.labelPattern, n),
      playFrom,
      playTo: addDaysIso(playFrom, windowDays - 1),
      holes: input.holes,
    });
  }
  return out;
}
