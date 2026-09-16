/**
 * A game's live score (Events program, phase 4 — 215: `side1_score`,
 * `side2_score`, `period`, `score_version` ON the round) — pure. The two
 * sides are ad-hoc (the event's `format_config.game.side_names`, Home /
 * Away by default); a player's result is read from their side.
 */
import { DEFAULT_SIDE_NAMES } from './format-config';
import type { GameConfig } from './types';
import type { Parsed } from './validate';

export interface GameScore {
  side1_score: number | null;
  side2_score: number | null;
  period: number | null;
}

export type GameResult = 'W' | 'L' | 'T';

export const SCORE_MAX = 999;
export const PERIOD_MAX = 99;

/** W / L / T from `side`'s point of view; null while either score is unset. */
export function resultFor(side: 1 | 2, score: GameScore): GameResult | null {
  if (score.side1_score === null || score.side2_score === null) return null;
  const mine = side === 1 ? score.side1_score : score.side2_score;
  const theirs = side === 1 ? score.side2_score : score.side1_score;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
}

/** "4-2" from `side`'s point of view (the stat line's `result_score`); null while unset. */
export function resultScore(side: 1 | 2, score: GameScore): string | null {
  if (score.side1_score === null || score.side2_score === null) return null;
  return side === 1 ? `${score.side1_score}-${score.side2_score}` : `${score.side2_score}-${score.side1_score}`;
}

export function sideNamesOf(config: GameConfig | null | undefined): [string, string] {
  return config?.side_names ?? [DEFAULT_SIDE_NAMES[0], DEFAULT_SIDE_NAMES[1]];
}

/** "Home 4 – Away 2 · P3"; "Home – Away" before the first score. */
export function scoreLabel(score: GameScore, names: [string, string]): string {
  const head = score.side1_score === null || score.side2_score === null ? `${names[0]} – ${names[1]}` : `${names[0]} ${score.side1_score} – ${score.side2_score} ${names[1]}`;
  return score.period && score.period > 1 ? `${head} · P${score.period}` : head;
}

export interface ScoreWrite {
  side1_score: number;
  side2_score: number;
  period: number;
  expected_version: number;
}

/** The PUT body of the score: both sides (0..999), the period (1..99, default 1), the version last seen. */
export function parseScoreWrite(body: unknown): Parsed<ScoreWrite> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be an object' };
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) if (!['side1_score', 'side2_score', 'period', 'expected_version'].includes(key)) return { ok: false, error: `Unknown field: ${key}` };
  const score = (v: unknown, name: string): Parsed<number> => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= SCORE_MAX ? { ok: true, value: v } : { ok: false, error: `${name} must be a whole number from 0 to ${SCORE_MAX}` });
  const s1 = score(b.side1_score, 'side1_score');
  if (!s1.ok) return s1;
  const s2 = score(b.side2_score, 'side2_score');
  if (!s2.ok) return s2;
  const period = b.period === undefined ? 1 : b.period;
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 1 || period > PERIOD_MAX) return { ok: false, error: `period must be a whole number from 1 to ${PERIOD_MAX}` };
  const ev = b.expected_version;
  if (typeof ev !== 'number' || !Number.isInteger(ev) || ev < 0) return { ok: false, error: 'expected_version must be a whole number' };
  return { ok: true, value: { side1_score: s1.value, side2_score: s2.value, period, expected_version: ev } };
}
