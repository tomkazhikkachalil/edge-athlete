// ── Climbs with grades and sends (activities details A8, Oct 16 2026) ───────
// Pure, ZERO imports. Tom's review: climbers care about style and grades —
// a climbing session is the climbs: each one's grade and whether it was SENT
// (topped clean) or an attempt. The list lives in `activities.details.climbs`
// (265 — one jsonb object, no DDL), capped at 50; the grade scale is the
// session's own answer (`details.scale`), so every climb in a session reads
// on one scale and can be compared.
//
// Five scales: V-scale and Font for bouldering, YDS and French for routes,
// and a gym's colour circuit for gyms without grades. Colours rank only when
// the athlete says their gym's colours run in the listed order — otherwise a
// "hardest send" would be a guess, and none is shown.

export const CLIMB_SCALES = ['v', 'font', 'yds', 'french', 'colour'] as const;
export type ClimbScale = (typeof CLIMB_SCALES)[number];

export const CLIMB_SCALE_LABELS: Readonly<Record<ClimbScale, string>> = {
  v: 'V-scale',
  font: 'Font',
  yds: 'YDS',
  french: 'French',
  colour: 'Gym colours',
};

const range = (prefix: string, from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

/** Easiest → hardest, per scale. */
export const CLIMB_GRADES: Readonly<Record<ClimbScale, readonly string[]>> = {
  v: ['VB', ...range('V', 0, 17)],
  font: ['3', '4', '4+', '5', '5+', ...['6', '7', '8'].flatMap(n => ['A', 'A+', 'B', 'B+', 'C', 'C+'].map(l => `${n}${l}`)), '9A'],
  yds: [...range('5.', 5, 9), ...range('', 10, 15).flatMap(n => ['a', 'b', 'c', 'd'].map(l => `5.${n}${l}`))],
  french: ['4a', '4b', '4c', '5a', '5b', '5c', ...['6', '7', '8', '9'].flatMap(n => ['a', 'a+', 'b', 'b+', 'c', 'c+'].map(l => `${n}${l}`))],
  colour: ['white', 'yellow', 'green', 'blue', 'red', 'purple', 'black', 'pink', 'orange'],
};

export const COLOUR_LABELS: Readonly<Record<string, string>> = {
  white: 'White',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  red: 'Red',
  purple: 'Purple',
  black: 'Black',
  pink: 'Pink',
  orange: 'Orange',
};

/** The colours a gym's circuit is taken to run in, when the athlete says so (pink and orange are off the ladder). */
export const COLOUR_ORDER: readonly string[] = ['white', 'yellow', 'green', 'blue', 'red', 'purple', 'black'];

export const CLIMB_STYLES = ['bouldering', 'top_rope', 'lead'] as const;
export type ClimbStyle = (typeof CLIMB_STYLES)[number];

/** The scales each style offers (the first is the default). */
export const SCALES_FOR_STYLE: Readonly<Record<ClimbStyle, readonly ClimbScale[]>> = {
  bouldering: ['v', 'font', 'colour'],
  top_rope: ['yds', 'french', 'colour'],
  lead: ['yds', 'french', 'colour'],
};

export const CLIMBS_MAX = 50;
export const ATTEMPTS_MAX = 50;

export interface Climb {
  grade: string;
  /** Topped clean; an attempt otherwise. */
  sent: boolean;
  /** Tries it took (a send) or made (an attempt). */
  attempts?: number;
  /** Seconds into the recording it was logged; absent when added after. */
  at_s?: number;
}

export function isClimbScale(v: unknown): v is ClimbScale {
  return typeof v === 'string' && (CLIMB_SCALES as readonly string[]).includes(v);
}

/** The grade's place on its scale (0 = easiest), or -1 when it is not one. */
export function gradeRank(scale: ClimbScale, grade: string): number {
  return CLIMB_GRADES[scale].indexOf(grade);
}

/** One climb, or null when it is not one on this scale. Unknown keys make it invalid. */
export function validClimb(scale: ClimbScale, raw: unknown): Climb | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some(k => !['grade', 'sent', 'attempts', 'at_s'].includes(k))) return null;
  if (typeof r.grade !== 'string' || gradeRank(scale, r.grade) < 0) return null;
  if (typeof r.sent !== 'boolean') return null;
  const out: Climb = { grade: r.grade, sent: r.sent };
  if (r.attempts !== undefined) {
    if (typeof r.attempts !== 'number' || !Number.isInteger(r.attempts) || r.attempts < 1 || r.attempts > ATTEMPTS_MAX) return null;
    out.attempts = r.attempts;
  }
  if (r.at_s !== undefined) {
    if (typeof r.at_s !== 'number' || !Number.isInteger(r.at_s) || r.at_s < 0 || r.at_s > 172_800) return null;
    out.at_s = r.at_s;
  }
  return out;
}

/**
 * The stored list for a scale: the valid climbs, in order, at most 50. Used
 * where a value is READ (an invalid entry is dropped quietly); the server
 * refuses an invalid list by name instead (details-schema.ts).
 */
export function climbsFrom(scale: ClimbScale, raw: unknown): Climb[] {
  if (!Array.isArray(raw)) return [];
  const out: Climb[] = [];
  for (const c of raw) {
    const v = validClimb(scale, c);
    if (v) out.push(v);
    if (out.length >= CLIMBS_MAX) break;
  }
  return out;
}

export interface ClimbSummary {
  climbs: number;
  sends: number;
  /** The hardest SEND (attempts never count), or null — none sent, or colours with no order. */
  hardest: string | null;
}

export function summarizeClimbs(scale: ClimbScale, climbs: readonly Climb[], coloursOrdered = false): ClimbSummary {
  const sends = climbs.filter(c => c.sent);
  let hardest: string | null = null;
  const rankOf = (g: string) => (scale === 'colour' ? (coloursOrdered ? COLOUR_ORDER.indexOf(g) : -1) : gradeRank(scale, g));
  let best = -1;
  for (const c of sends) {
    const r = rankOf(c.grade);
    if (r > best) {
      best = r;
      hardest = c.grade;
    }
  }
  return { climbs: climbs.length, sends: sends.length, hardest };
}

/** "V4", "6B+", "5.10a", "Blue". */
export function gradeLabel(scale: ClimbScale, grade: string): string {
  return scale === 'colour' ? (COLOUR_LABELS[grade] ?? grade) : grade;
}

/** "V4 · Sent · 3 tries" / "V5 · Attempt". */
export function climbLine(scale: ClimbScale, c: Climb): string {
  const tries = c.attempts && c.attempts > 1 ? `${c.attempts} tries` : null;
  return [gradeLabel(scale, c.grade), c.sent ? 'Sent' : 'Attempt', tries].filter(Boolean).join(' · ');
}
