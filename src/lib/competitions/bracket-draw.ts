/**
 * The knockout bracket over CONTESTS (Competition formats, track 2, PR 3 —
 * 218 `contests.stage` / `slot`) — pure. The Events phase 3 rule, kept:
 * slot k of stage n+1 is fed by slots 2k−1 and 2k of stage n — BY SLOT,
 * never by id. Seeds place in the classic order (1 and 2 in opposite
 * halves: size 8 → 1v8 · 4v5 · 2v7 · 3v6); a seed beyond the field is a
 * BYE and **a bye is never a contest** — the advancing entry is pre-filled
 * into its next-stage slot at the draw. Advancement (`bracketFill`) never
 * touches a slot holding a result; a feeder whose winner changed clears
 * downstream only while downstream has no result. The standings are the
 * progression (champion 1, runner-up 2, the semifinal losers share 3 …).
 */
import { bracketRoundName, bracketRoundsNeeded } from '@/lib/sport-events/bracket';
import { assignSharedRanks, type StandingRow, type StandingsColumn } from './scoring';

export interface SeededEntry {
  entryId: string;
  /** 1-based; the generator reads the seeded order. */
  seed: number;
}

export interface DrawContest {
  stage: number;
  slot: number;
  /** "Final" · "Semifinals" · "Quarterfinals" · "Round of 16". */
  round: string;
  home: string | null;
  away: string | null;
}

export interface BracketDraw {
  /** 2^stages — the field padded with byes. */
  size: number;
  stages: number;
  contests: DrawContest[];
  /** The seeds that advanced on a bye at the draw. */
  byes: string[];
}

/** The classic seed order for a field of 2^k: [1,2] → [1,4,2,3] → [1,8,4,5,2,7,3,6] — seeds 1 and 2 meet only in the final. */
export function bracketOrder(size: number): number[] {
  let seq = [1];
  while (seq.length < size) {
    const n = seq.length * 2;
    const next: number[] = [];
    for (const s of seq) next.push(s, n + 1 - s);
    seq = next;
  }
  return seq.slice(0, size);
}

export function bracketDraw(seeded: ReadonlyArray<SeededEntry>): BracketDraw {
  const ordered = [...seeded].sort((a, b) => a.seed - b.seed);
  const n = ordered.length;
  if (n < 2) return { size: 0, stages: 0, contests: [], byes: [] };
  const stages = bracketRoundsNeeded(n);
  const size = 2 ** stages;
  const order = bracketOrder(size);
  const bySeed = new Map(ordered.map((e, i) => [i + 1, e.entryId]));
  const prefill = new Map<string, { home: string | null; away: string | null }>();
  const key = (stage: number, slot: number) => `${stage}:${slot}`;
  const contests: DrawContest[] = [];
  const byes: string[] = [];
  const firstSlots = size / 2;
  for (let k = 1; k <= firstSlots; k++) {
    const a = order[2 * k - 2];
    const b = order[2 * k - 1];
    const ea = bySeed.get(a) ?? null;
    const eb = bySeed.get(b) ?? null;
    if (ea && eb) {
      // Home = the higher seed (the lower number).
      contests.push({ stage: 1, slot: k, round: bracketRoundName(firstSlots), home: a < b ? ea : eb, away: a < b ? eb : ea });
      continue;
    }
    const survivor = ea ?? eb;
    if (!survivor) continue;
    byes.push(survivor);
    const target = key(2, Math.ceil(k / 2));
    const cur = prefill.get(target) ?? { home: null, away: null };
    if (k % 2 === 1) cur.home = survivor; else cur.away = survivor;
    prefill.set(target, cur);
  }
  for (let stage = 2; stage <= stages; stage++) {
    const slots = size / 2 ** stage;
    for (let k = 1; k <= slots; k++) {
      const pre = prefill.get(key(stage, k)) ?? { home: null, away: null };
      contests.push({ stage, slot: k, round: bracketRoundName(slots), home: pre.home, away: pre.away });
    }
  }
  return { size, stages, contests, byes };
}

export interface BracketContestRow {
  id: string;
  stage: number;
  slot: number;
  status: string;
  home: string | null;
  away: string | null;
  /** The decided winner (the one ranking rule's answer); null while undecided. */
  winnerEntryId: string | null;
  /** Any result row exists on the contest. */
  hasResult: boolean;
}

export interface FillOp {
  contestId: string;
  side: 'home' | 'away';
  /** null = clear the side (the feeder's winner changed, downstream has no result). */
  entryId: string | null;
}

/** The side assignments the current results imply — a slot holding a result is never touched. */
export function bracketFill(contests: ReadonlyArray<BracketContestRow>): FillOp[] {
  const at = new Map(contests.map(c => [`${c.stage}:${c.slot}`, c]));
  const ops: FillOp[] = [];
  for (const c of contests) {
    if (c.stage < 2 || c.hasResult) continue;
    const feeders: Array<['home' | 'away', BracketContestRow | undefined]> = [
      ['home', at.get(`${c.stage - 1}:${2 * c.slot - 1}`)],
      ['away', at.get(`${c.stage - 1}:${2 * c.slot}`)],
    ];
    for (const [side, feeder] of feeders) {
      if (!feeder) continue; // a bye consumed at the draw — the pre-filled entry stays
      const want = feeder.winnerEntryId;
      const have = c[side];
      if (want !== have) ops.push({ contestId: c.id, side, entryId: want });
    }
  }
  return ops;
}

export const BRACKET_COLUMNS: StandingsColumn[] = [
  { key: 'reached', label: 'Round reached', shortLabel: 'R' },
  { key: 'w', label: 'Won', shortLabel: 'W' },
  { key: 'l', label: 'Lost', shortLabel: 'L' },
];

/** The progression as standings: the champion 1, the runner-up 2, the semifinal losers share 3, … an entry never drawn last. */
export function computeBracketStandings(entryIds: ReadonlyArray<string>, contests: ReadonlyArray<BracketContestRow>): StandingRow[] {
  const stages = contests.reduce((m, c) => Math.max(m, c.stage), 0);
  const final = contests.find(c => c.stage === stages && c.slot === 1) ?? null;
  const rows = entryIds.map(entryId => {
    let reached = 0;
    let w = 0;
    let l = 0;
    let played = 0;
    for (const c of contests) {
      const inIt = c.home === entryId || c.away === entryId;
      if (!inIt) continue;
      reached = Math.max(reached, c.stage);
      if (c.winnerEntryId) {
        played += 1;
        if (c.winnerEntryId === entryId) w += 1; else l += 1;
      }
    }
    const champion = final?.winnerEntryId === entryId;
    const key = champion ? stages + 1 : reached;
    return { entry_id: entryId, key, played, stats: { reached, w, l } };
  });
  rows.sort((a, b) => b.key - a.key || b.stats.w - a.stats.w || a.entry_id.localeCompare(b.entry_id));
  const ranks = assignSharedRanks(rows.length, i => rows[i].key);
  return rows.map((r, i) => ({ entry_id: r.entry_id, rank: ranks[i], points: null, played: r.played, stats: r.stats }));
}

export type SeedsRefusal = 'not_approved' | 'duplicate' | 'missing' | 'bracket_drawn';

/** The FULL seeded order (the flights PUT precedent): every id an approved entry, no repeats, nothing after the draw exists. */
export function seedsRefusal(entryIds: ReadonlyArray<string>, entries: ReadonlyArray<{ id: string; status: string }>, drawn: boolean): SeedsRefusal | null {
  if (drawn) return 'bracket_drawn';
  if (new Set(entryIds).size !== entryIds.length) return 'duplicate';
  const byId = new Map(entries.map(e => [e.id, e]));
  for (const id of entryIds) {
    const e = byId.get(id);
    if (!e) return 'missing';
    if (e.status !== 'approved') return 'not_approved';
  }
  return null;
}

export const SEEDS_REFUSAL_COPY: Readonly<Record<SeedsRefusal, string>> = {
  not_approved: 'Only approved entries can be seeded.',
  duplicate: 'An entry appears twice in the order.',
  missing: 'An entry in the order is not in this competition.',
  bracket_drawn: 'The bracket is drawn — regenerate it to change the seeds.',
};

export interface BracketColumnView {
  stage: number;
  name: string;
  slots: Array<{ slot: number; contestId: string | null; home: { entryId: string; name: string } | null; away: { entryId: string; name: string } | null; winnerEntryId: string | null; status: string }>;
}

/** The bracket as columns (the events BracketView's shape) from the contests — for the console and the public block (PR 4). */
export function bracketColumnsFromContests(contests: ReadonlyArray<BracketContestRow>, nameOf: (entryId: string) => string): BracketColumnView[] {
  const stages = contests.reduce((m, c) => Math.max(m, c.stage), 0);
  const size = 2 ** stages;
  const out: BracketColumnView[] = [];
  for (let stage = 1; stage <= stages; stage++) {
    const slots = size / 2 ** stage;
    const col: BracketColumnView = { stage, name: bracketRoundName(slots), slots: [] };
    for (let k = 1; k <= slots; k++) {
      const c = contests.find(x => x.stage === stage && x.slot === k) ?? null;
      const side = (id: string | null) => (id ? { entryId: id, name: nameOf(id) } : null);
      col.slots.push({ slot: k, contestId: c?.id ?? null, home: side(c?.home ?? null), away: side(c?.away ?? null), winnerEntryId: c?.winnerEntryId ?? null, status: c?.status ?? 'bye' });
    }
    out.push(col);
  }
  return out;
}
