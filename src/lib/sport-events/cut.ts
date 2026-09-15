/**
 * The cut (Events program, phase 2) — pure. After round K completes, the
 * standing THROUGH round K decides who plays on: the top N by rank (ties at
 * the nth place ALL make it — shared ranks are the one ranking rule, so a
 * rank ≤ N includes everyone tied there) or everyone at or under a to-par
 * score. A player with no rank through K (never scored) misses. The
 * missed-cut set is excluded from the mint of every later round and ranks
 * below the line on the overall board; nothing here is stored — the cut is
 * re-derived from the cards on every read.
 */
import type { CutRule } from './types';

export interface CutCandidate {
  participantId: string;
  /** The rank through round K (shared), null when unranked. */
  rank: number | null;
  /** The format key's to-par through round K (gross or net), null when unranked. */
  keyToPar: number | null;
  /** The format key's total through round K, for the line's score. */
  key: number | null;
}

export interface CutLine {
  afterRound: number;
  /** The key's value of the last player who made it (the "cut score"); null when nobody did. */
  score: number | null;
  madeCut: number;
  missed: number;
}

/** Who made the cut, from the standing through round K (rows already ranked). */
export function applyCut(rowsThroughK: ReadonlyArray<CutCandidate>, rule: CutRule): { made: Set<string>; line: CutLine } {
  const made = new Set<string>();
  let score: number | null = null;
  for (const r of rowsThroughK) {
    if (r.rank === null) continue;
    const ok = typeof rule.top_n === 'number' ? r.rank <= rule.top_n : typeof rule.to_par === 'number' ? (r.keyToPar ?? Number.POSITIVE_INFINITY) <= rule.to_par : true;
    if (!ok) continue;
    made.add(r.participantId);
    if (r.key !== null && (score === null || r.key > score)) score = r.key;
  }
  return { made, line: { afterRound: rule.after_round, score, madeCut: made.size, missed: rowsThroughK.length - made.size } };
}

/** The cut is decided once the round it follows is completed. */
export function cutDecided(rule: CutRule | null | undefined, rounds: ReadonlyArray<{ sequence: number; status: string }>): boolean {
  if (!rule) return false;
  return rounds.some(r => r.sequence === rule.after_round && r.status === 'completed');
}

/** A cut may still be set or changed while the round it follows has not completed. */
export function cutEditable(rule: CutRule, rounds: ReadonlyArray<{ sequence: number; status: string }>): boolean {
  return !rounds.some(r => r.sequence <= rule.after_round && r.status === 'completed');
}
