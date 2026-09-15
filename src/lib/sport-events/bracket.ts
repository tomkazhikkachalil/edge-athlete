/**
 * Brackets — pure (Events program, phase 3). A bracket is nothing new: the
 * rounds ARE the bracket rounds, and match k of round n+1 is fed by matches
 * 2k−1 and 2k of round n — by group SEQUENCE (the PUT re-mints group ids
 * on every save). The organizer sets every draw by hand (Tom's decision);
 * "Fill from winners" pre-fills the next round in bracket order and stays
 * editable; a one-side group is a bye.
 */
import type { Side } from './match-types';

export interface BracketMatch {
  sequence: number;
  groupId: string | null;
  /** Participant ids per side, position order. */
  sides: [string[], string[]];
  winnerSide: Side | null;
  decidedBy: string | null;
  result: string | null;
}

export interface BracketDrawGroup {
  sequence: number;
  name: string;
  sides: [string[], string[]];
  /** The previous round's matches this group is fed by. */
  feeders: [number, number];
}

/** Match k of the next round is fed by matches 2k−1 and 2k. */
export function bracketFeeders(k: number): [number, number] {
  return [2 * k - 1, 2 * k];
}

/** Final · Semifinals · Quarterfinals · Round of 2n. */
export function bracketRoundName(matchCount: number): string {
  if (matchCount <= 1) return 'Final';
  if (matchCount === 2) return 'Semifinals';
  if (matchCount === 4) return 'Quarterfinals';
  return `Round of ${matchCount * 2}`;
}

/** Rounds a knockout of n entrants needs (byes fill the tail). */
export function bracketRoundsNeeded(entrants: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(1, entrants))));
}

/** The winning side's members of a decided match; empty when undecided. */
export function winnersOf(m: BracketMatch | undefined): string[] {
  if (!m || !m.winnerSide) return [];
  return m.sides[m.winnerSide - 1];
}

/**
 * The next round's draw from the previous round's matches: match k takes
 * the winners of 2k−1 (side 1) and 2k (side 2); an undecided feeder leaves
 * the side EMPTY (the editor shows "Winner of match n" and start refuses
 * `groups_incomplete`); a missing second feeder is a bye. Names "Match k".
 */
export function bracketNextRound(prev: ReadonlyArray<BracketMatch>): BracketDrawGroup[] {
  const bySeq = new Map(prev.map(m => [m.sequence, m]));
  const count = Math.max(0, Math.ceil(prev.length / 2));
  const out: BracketDrawGroup[] = [];
  for (let k = 1; k <= count; k++) {
    const [f1, f2] = bracketFeeders(k);
    out.push({ sequence: k, name: `Match ${k}`, sides: [winnersOf(bySeq.get(f1)), winnersOf(bySeq.get(f2))], feeders: [f1, f2] });
  }
  return out;
}

export interface BracketSlotSide {
  members: string[];
  /** When empty: "TBD" or "Winner of match n". */
  label: string | null;
}
export interface BracketSlot {
  sequence: number;
  groupId: string | null;
  sides: [BracketSlotSide, BracketSlotSide];
  winnerSide: Side | null;
  result: string | null;
}
export interface BracketColumn {
  roundId: string;
  sequence: number;
  name: string;
  status: string;
  slots: BracketSlot[];
}

/** The view's model: every slot filled by a name list or a placeholder — "Winner of match n" once a previous round exists, "TBD" on the first. */
export function bracketColumns(rounds: ReadonlyArray<{ id: string; sequence: number; name: string | null; status: string; matches: BracketMatch[] }>): BracketColumn[] {
  const ordered = [...rounds].sort((a, b) => a.sequence - b.sequence);
  return ordered.map((r, i) => {
    const prevExists = i > 0;
    const slots: BracketSlot[] = [...r.matches].sort((a, b) => a.sequence - b.sequence).map(m => {
      const [f1, f2] = bracketFeeders(m.sequence);
      const side = (members: string[], feeder: number): BracketSlotSide => ({ members, label: members.length > 0 ? null : prevExists ? `Winner of match ${feeder}` : 'TBD' });
      return { sequence: m.sequence, groupId: m.groupId, sides: [side(m.sides[0], f1), side(m.sides[1], f2)], winnerSide: m.winnerSide, result: m.result };
    });
    return { roundId: r.id, sequence: r.sequence, name: r.name ?? bracketRoundName(slots.length), status: r.status, slots };
  });
}

/** The Final's winner (the last column's single decided match), or null. */
export function bracketWinner(cols: ReadonlyArray<BracketColumn>): { participantIds: string[] } | null {
  const last = cols[cols.length - 1];
  if (!last || last.slots.length !== 1) return null;
  const s = last.slots[0];
  if (!s.winnerSide) return null;
  return { participantIds: s.sides[s.winnerSide - 1].members };
}
