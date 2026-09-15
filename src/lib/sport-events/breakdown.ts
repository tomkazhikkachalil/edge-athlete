/**
 * Breakdowns (Events program, phase 2) — pure. A player's round, and a
 * tournament's rounds, as the categories a golfer reads: front / back,
 * par 3s / 4s / 5s, eagles → double-plus, putts, fairways, greens,
 * penalties — and the event's hardest holes across every card. Reuses the
 * golf primitives (`calcPlayerTotals`, `holePar`, `classifyScore`); an
 * off-catalog round scores against par 4 over its range, the totals
 * trigger's rule. Nothing here is stored — the breakdown route computes
 * it from the cards on every read.
 */
import type { HardestHole } from '@/lib/golf/course-stats';
import { calcPlayerTotals, holePar } from '@/lib/golf/scoring';
import type { SportEventHoleDatum } from './types';

export interface BreakdownHole {
  hole_number: number;
  strokes: number | null;
  putts?: number | null;
  fairway_hit?: boolean | null;
  green_in_regulation?: boolean | null;
  penalties?: string[] | null;
}

export interface RoundRange {
  holes: 9 | 18;
  startingHole: 1 | 10;
}

export interface SplitTotals {
  holes: number;
  strokes: number;
  toPar: number;
}

export interface ParBucket extends SplitTotals {
  /** Strokes per hole in this bucket; null with no holes. */
  avg: number | null;
}

export interface PlayerBreakdown {
  played: number;
  gross: number;
  toPar: number;
  front: SplitTotals;
  back: SplitTotals;
  byPar: { 3: ParBucket; 4: ParBucket; 5: ParBucket; 6: ParBucket };
  counts: { eagle: number; birdie: number; par: number; bogey: number; doublePlus: number };
  putts: { total: number; tracked: number; perHole: number | null };
  /** Par 3s are never a fairway: `tracked` counts par-4+ holes with a recorded fairway. */
  fir: { hit: number; tracked: number };
  gir: { hit: number; tracked: number };
  penalties: number;
}

const bucket = (): ParBucket => ({ holes: 0, strokes: 0, toPar: 0, avg: null });

export function emptyBreakdown(): PlayerBreakdown {
  return {
    played: 0, gross: 0, toPar: 0,
    front: { holes: 0, strokes: 0, toPar: 0 },
    back: { holes: 0, strokes: 0, toPar: 0 },
    byPar: { 3: bucket(), 4: bucket(), 5: bucket(), 6: bucket() },
    counts: { eagle: 0, birdie: 0, par: 0, bogey: 0, doublePlus: 0 },
    putts: { total: 0, tracked: 0, perHole: null },
    fir: { hit: 0, tracked: 0 },
    gir: { hit: 0, tracked: 0 },
    penalties: 0,
  };
}

/** The round's holes and their pars: the catalog's when present, else par 4 over the range. */
export function parMap(holeData: SportEventHoleDatum[] | null | undefined, range: RoundRange): Map<number, number> {
  const out = new Map<number, number>();
  if (holeData && holeData.length > 0) {
    for (const h of holeData) out.set(h.hole, h.par);
    return out;
  }
  const first = range.holes === 9 ? range.startingHole : 1;
  for (let n = first; n < first + range.holes && n <= 18; n++) out.set(n, 4);
  return out;
}

function scoredWithin(holes: ReadonlyArray<BreakdownHole>, pars: Map<number, number>): BreakdownHole[] {
  return holes.filter(h => typeof h.strokes === 'number' && h.strokes > 0 && pars.has(h.hole_number));
}

export function playerBreakdown(holes: ReadonlyArray<BreakdownHole>, holeData: SportEventHoleDatum[] | null | undefined, range: RoundRange): PlayerBreakdown {
  const pars = parMap(holeData, range);
  const holeSource = [...pars.entries()].map(([hole, par]) => ({ hole, par }));
  const scored = scoredWithin(holes, pars);
  const out = emptyBreakdown();
  if (scored.length === 0) return out;
  const totals = calcPlayerTotals(scored, holeSource, 4);
  out.played = totals.played;
  out.gross = totals.total;
  out.toPar = totals.toPar;
  out.counts = { eagle: totals.eagles, birdie: totals.birdies, par: totals.pars, bogey: totals.bogeys, doublePlus: totals.doublePlus };
  for (const h of scored) {
    const strokes = h.strokes as number;
    const par = holePar(h.hole_number, holeSource, 4);
    const side = h.hole_number <= 9 ? out.front : out.back;
    side.holes += 1;
    side.strokes += strokes;
    side.toPar += strokes - par;
    const key = (par <= 3 ? 3 : par >= 6 ? 6 : par) as 3 | 4 | 5 | 6;
    const b = out.byPar[key];
    b.holes += 1;
    b.strokes += strokes;
    b.toPar += strokes - par;
    if (typeof h.putts === 'number' && h.putts >= 0) { out.putts.total += h.putts; out.putts.tracked += 1; }
    if (par > 3 && typeof h.fairway_hit === 'boolean') { out.fir.tracked += 1; if (h.fairway_hit) out.fir.hit += 1; }
    if (typeof h.green_in_regulation === 'boolean') { out.gir.tracked += 1; if (h.green_in_regulation) out.gir.hit += 1; }
    if (Array.isArray(h.penalties)) out.penalties += h.penalties.length;
  }
  finishAverages(out);
  return out;
}

function finishAverages(b: PlayerBreakdown): void {
  for (const k of [3, 4, 5, 6] as const) {
    const bk = b.byPar[k];
    bk.avg = bk.holes > 0 ? Math.round((bk.strokes / bk.holes) * 100) / 100 : null;
  }
  b.putts.perHole = b.putts.tracked > 0 ? Math.round((b.putts.total / b.putts.tracked) * 100) / 100 : null;
}

/** Several rounds' breakdowns as one (a tournament's "All rounds"): sums, then the averages again. */
export function aggregateBreakdowns(list: ReadonlyArray<PlayerBreakdown>): PlayerBreakdown {
  const out = emptyBreakdown();
  for (const b of list) {
    out.played += b.played;
    out.gross += b.gross;
    out.toPar += b.toPar;
    for (const side of ['front', 'back'] as const) {
      out[side].holes += b[side].holes;
      out[side].strokes += b[side].strokes;
      out[side].toPar += b[side].toPar;
    }
    for (const k of [3, 4, 5, 6] as const) {
      out.byPar[k].holes += b.byPar[k].holes;
      out.byPar[k].strokes += b.byPar[k].strokes;
      out.byPar[k].toPar += b.byPar[k].toPar;
    }
    for (const k of ['eagle', 'birdie', 'par', 'bogey', 'doublePlus'] as const) out.counts[k] += b.counts[k];
    out.putts.total += b.putts.total;
    out.putts.tracked += b.putts.tracked;
    out.fir.hit += b.fir.hit;
    out.fir.tracked += b.fir.tracked;
    out.gir.hit += b.gir.hit;
    out.gir.tracked += b.gir.tracked;
    out.penalties += b.penalties;
  }
  finishAverages(out);
  return out;
}

/**
 * The event's hardest holes: every card's scored holes, the average over
 * par per hole, hardest first (then the lower hole number). A hole needs
 * `minTracked` cards to count — one player's blow-up is not the hole's.
 * Every qualifying hole is returned; the panel decides how many to show.
 */
export function eventHardestHoles(cards: ReadonlyArray<{ holes: ReadonlyArray<BreakdownHole> }>, holeData: SportEventHoleDatum[] | null | undefined, range: RoundRange, minTracked = 2): HardestHole[] {
  const pars = parMap(holeData, range);
  const acc = new Map<number, { over: number; tracked: number }>();
  for (const card of cards) {
    for (const h of scoredWithin(card.holes, pars)) {
      const par = pars.get(h.hole_number) as number;
      const a = acc.get(h.hole_number) ?? { over: 0, tracked: 0 };
      a.over += (h.strokes as number) - par;
      a.tracked += 1;
      acc.set(h.hole_number, a);
    }
  }
  return [...acc.entries()]
    .filter(([, a]) => a.tracked >= minTracked)
    .map(([hole, a]) => ({ hole, par: pars.get(hole) ?? null, avgOverPar: Math.round((a.over / a.tracked) * 100) / 100, tracked: a.tracked }))
    .sort((a, b) => b.avgOverPar - a.avgOverPar || a.hole - b.hole);
}

/** "+0.5" / "E" / "−0.25" for an average over par. */
export function formatAvgOverPar(v: number): string {
  if (v === 0) return 'E';
  const s = Math.abs(v) < 10 ? Math.abs(v).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : String(Math.abs(v));
  return v > 0 ? `+${s}` : `−${s}`;
}
