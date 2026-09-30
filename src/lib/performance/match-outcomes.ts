import type { PerformanceOutcome } from './types';

/**
 * A completed match round's outcome per PLAYER — 244, the Play program.
 * Pure. The golf mapper never sends `side` / `outcome` (a round edit must
 * not NULL them), so a match round's result is STAMPED onto its players'
 * rows once, at completion, after the mirror wrote them
 * (`write-server.ts stampMatchOutcomes`, called from the lifecycle right
 * after `closeMatchesOnCompletion`).
 *
 * The winner is the one `closeMatchesOnCompletion` writes: a stored
 * decision (organizer / concession / bye) wins over the computation. A bye
 * is not a game played (no rivalry, no win); an undecided match stamps
 * nothing.
 */

/** The key under a golf row's `context` that names its match (the unit a
 *  side / outcome belongs to — see play/versus.ts). */
export const MATCH_UNIT_KEY = 'match';

export interface MatchForOutcome {
  id: string;
  bye: boolean;
  sides: ReadonlyArray<{ side: 1 | 2; members: ReadonlyArray<{ profile_id: string }> }>;
  state: { winnerSide: 1 | 2 | null };
  stored: { winner_side: 1 | 2 | null };
}

export interface MatchOutcomeEntry {
  profileId: string;
  matchId: string;
  side: 1 | 2;
  outcome: PerformanceOutcome;
}

export function matchOutcomeEntries(matches: ReadonlyArray<MatchForOutcome>): MatchOutcomeEntry[] {
  const out: MatchOutcomeEntry[] = [];
  for (const m of matches) {
    if (m.bye) continue;
    const winner = m.stored.winner_side ?? m.state.winnerSide;
    if (winner !== 1 && winner !== 2) continue;
    for (const s of m.sides) {
      for (const member of s.members) out.push({ profileId: member.profile_id, matchId: m.id, side: s.side, outcome: s.side === winner ? 'win' : 'loss' });
    }
  }
  return out;
}

/**
 * A re-mirror (a round edit, the backfill) rebuilds a golf row's `context`
 * from the round, which knows nothing of matches — so the writer carries
 * an already-stamped match id forward, exactly as side / outcome survive by
 * never being sent. Pure: `existing` maps natural_key → the stored match id.
 */
export function carryMatchUnit<T extends { natural_key: string; context_key?: string | null; context?: Record<string, unknown> | null }>(
  rows: readonly T[],
  existing: ReadonlyMap<string, string>
): T[] {
  return rows.map(r => {
    const unit = existing.get(r.natural_key);
    if (!unit || !r.context_key?.startsWith('group_post:')) return r;
    if (r.context && typeof r.context[MATCH_UNIT_KEY] === 'string') return r;
    return { ...r, context: { ...(r.context ?? {}), [MATCH_UNIT_KEY]: unit } };
  });
}
