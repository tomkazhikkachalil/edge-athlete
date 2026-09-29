import { contextKindOf, headlineDirection, type PerformanceOutcome } from '@/lib/performance/types';

/**
 * Head-to-head — the Play program (244). Pure, client-safe, every sport.
 *
 * Two athletes' performance rows that share a `context_key` played the same
 * game. ONE fold turns those pairs into a record from A's side:
 *
 *  • SAME SIDE (both rows name the side, and it matches) → the TOGETHER
 *    record: the team's result.
 *  • BOTH OUTCOMES (a game, a match) → A's outcome decides. Two rows with
 *    the same win / loss and no sides were teammates; two ties with no
 *    sides are ambiguous (together or apart) → undecided.
 *  • NO OUTCOMES, a golf shared round (`group_post:`) → stroke play: the
 *    better headline in the sport's direction wins, over the SAME number of
 *    holes only (a 9 never beats an 18).
 *  • anything else (a session, a contest line whose outcome is parked) →
 *    played, undecided: it counts as an encounter, never a result.
 *
 * `verified` counts the decided encounters where BOTH rows are verified —
 * the "Verified" mark Tom asked for (every result counts; verified ones are
 * marked).
 */

export interface VersusRow {
  context_key: string | null;
  sport_key: string;
  occurred_on: string; // YYYY-MM-DD
  side: 1 | 2 | null;
  outcome: PerformanceOutcome | null;
  headline: number | null;
  holes?: number | null;
  verified: boolean;
}

export type EncounterResult = 'W' | 'L' | 'T';

export interface Encounter {
  contextKey: string;
  sportKey: string;
  on: string;
  together: boolean;
  /** A's result; null = played, no result. */
  result: EncounterResult | null;
  verified: boolean;
}

export interface Record3 { wins: number; losses: number; ties: number }

export interface HeadToHead {
  sportKey: string;
  encounters: number;
  versus: Record3 & { undecided: number };
  together: Record3;
  /** The last five decided meetings as opponents, newest first. */
  lastFive: EncounterResult[];
  verified: number;
  lastPlayed: string | null;
}

const RESULT_OF: Record<PerformanceOutcome, EncounterResult> = { win: 'W', loss: 'L', tie: 'T' };

/** One shared game from A's side. Exported for the rivalry card on a single round. */
export function encounterOf(a: VersusRow, b: VersusRow): Encounter | null {
  if (!a.context_key || a.context_key !== b.context_key || a.sport_key !== b.sport_key) return null;
  const base = { contextKey: a.context_key, sportKey: a.sport_key, on: a.occurred_on };
  const both = a.verified && b.verified;

  if (a.side !== null && b.side !== null && a.side === b.side) {
    const result = a.outcome ? RESULT_OF[a.outcome] : null;
    return { ...base, together: true, result, verified: both && result !== null };
  }
  if (a.outcome && b.outcome) {
    const sidesKnown = a.side !== null && b.side !== null;
    if (!sidesKnown && a.outcome === b.outcome) {
      // Same result, no sides: teammates on a win / loss; a tie could be either.
      if (a.outcome === 'tie') return { ...base, together: false, result: null, verified: false };
      return { ...base, together: true, result: RESULT_OF[a.outcome], verified: both };
    }
    return { ...base, together: false, result: RESULT_OF[a.outcome], verified: both };
  }
  if (contextKindOf(a.context_key) === 'group_post' && typeof a.headline === 'number' && typeof b.headline === 'number') {
    const sameHoles = (a.holes ?? null) === (b.holes ?? null);
    if (sameHoles) {
      const lower = headlineDirection(a.sport_key) === 'lower';
      const diff = a.headline - b.headline;
      const result: EncounterResult = diff === 0 ? 'T' : (diff < 0) === lower ? 'W' : 'L';
      return { ...base, together: false, result, verified: both };
    }
  }
  return { ...base, together: false, result: null, verified: false };
}

/** Every shared game of A and B, folded per sport (most encounters first). */
export function foldHeadToHead(rowsA: readonly VersusRow[], rowsB: readonly VersusRow[]): HeadToHead[] {
  const bByContext = new Map<string, VersusRow>();
  for (const b of rowsB) if (b.context_key) bByContext.set(b.context_key, b);
  const bySport = new Map<string, Encounter[]>();
  for (const a of rowsA) {
    const b = a.context_key ? bByContext.get(a.context_key) : undefined;
    const e = b ? encounterOf(a, b) : null;
    if (!e) continue;
    const list = bySport.get(e.sportKey);
    if (list) list.push(e);
    else bySport.set(e.sportKey, [e]);
  }
  const out: HeadToHead[] = [];
  for (const [sportKey, list] of bySport) out.push(summarize(sportKey, list));
  return out.sort((x, y) => y.encounters - x.encounters || x.sportKey.localeCompare(y.sportKey));
}

export function summarize(sportKey: string, encounters: readonly Encounter[]): HeadToHead {
  const sorted = [...encounters].sort((x, y) => y.on.localeCompare(x.on) || y.contextKey.localeCompare(x.contextKey));
  const versus = { wins: 0, losses: 0, ties: 0, undecided: 0 };
  const together = { wins: 0, losses: 0, ties: 0 };
  const lastFive: EncounterResult[] = [];
  let verified = 0;
  for (const e of sorted) {
    if (e.verified) verified++;
    if (e.together) {
      if (e.result === 'W') together.wins++;
      else if (e.result === 'L') together.losses++;
      else if (e.result === 'T') together.ties++;
      continue;
    }
    if (e.result === null) { versus.undecided++; continue; }
    if (e.result === 'W') versus.wins++;
    else if (e.result === 'L') versus.losses++;
    else versus.ties++;
    if (lastFive.length < 5) lastFive.push(e.result);
  }
  return { sportKey, encounters: sorted.length, versus, together, lastFive, verified, lastPlayed: sorted[0]?.on ?? null };
}

/** "7–4–1" — wins, losses, ties (ties omitted when none). */
export function recordLine(r: Record3): string {
  return r.ties > 0 ? `${r.wins}–${r.losses}–${r.ties}` : `${r.wins}–${r.losses}`;
}
