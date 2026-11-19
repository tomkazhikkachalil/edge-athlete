// ── The scorecard from the map (Oct 31 2026) — pure, zero imports ───────────
// Tom: "I see the yardage from the GPS and map when I go to play. So how do we
// not know the scorecard?" A course's stored hole lines carry OSM's par and a
// measurable tee-to-green length. When there is no provider card, that IS a
// card: pars plus one measured yardage per hole. Only when complete: exactly 9
// or 18 consecutive holes, each with a real par and a drawable line. Never a
// partial card, and never handicaps or ratings the map does not have.
//
// Nov 18 2026 (Tom, reversing the Oct 31 "no estimates" rule for one case): a
// course whose lines are all drawn but whose pars are not all tagged gets a
// card too, with the missing pars ESTIMATED from the hole's length and every
// such hole marked. Measured that day on production's 8,522 fully tagged
// courses (148,330 holes): 93.8 % of holes right, 45 % of courses with every
// hole right, 75 % within one hole. So an estimate is shown and labelled, and
// is never evidence: the guards that compare a provider's card with the map
// read tagged pars only (sheetFromGeometry without `estimate`).

export const MAP_TEE = 'map';

/** QA accounts never count as picks (294). */
export function countsAsPick(email: string | null | undefined): boolean {
  return !(email ?? '').toLowerCase().startsWith('edgeqa-');
}

export interface MapSheetLine {
  hole: number;
  par?: number | null;
  line?: ReadonlyArray<readonly [number, number]> | null;
}

export interface MapSheetHole {
  number: number;
  par: number;
  yardage: Record<string, number>;
  handicap: number;
  /** The map had no par for this hole: `par` is estimatePar of its length. */
  parEstimated?: true;
}

/** Where a card came from when it is not a provider's: every par tagged on
 *  the map, or at least one estimated from length. */
export type MapSheetSource = 'map' | 'map_estimated';
export function isMapSheet(source: string | null | undefined): source is MapSheetSource {
  return source === 'map' || source === 'map_estimated';
}

/** The cut-offs between par 3 / 4 / 5 / 6 by measured length in yards, fitted
 *  Nov 18 2026 on half of production's tagged holes and checked on the other
 *  half (the pair that puts the most COURSES entirely right). */
export const PAR_CUTS_YARDS = [240, 460, 720] as const;

/** A hole's par from its measured length. An estimate, never a fact. */
export function estimatePar(yards: number): number {
  return yards < PAR_CUTS_YARDS[0] ? 3 : yards < PAR_CUTS_YARDS[1] ? 4 : yards < PAR_CUTS_YARDS[2] ? 5 : 6;
}

export function sheetFromGeometry(
  holes: ReadonlyArray<MapSheetLine> | null | undefined,
  measureYards: (line: ReadonlyArray<readonly [number, number]>) => number,
  opts: { estimate?: boolean } = {}
): MapSheetHole[] | null {
  if (!Array.isArray(holes) || (holes.length !== 9 && holes.length !== 18)) return null;
  const sorted = [...holes].sort((a, b) => a.hole - b.hole);
  const out: MapSheetHole[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i];
    if (h.hole !== i + 1) return null;
    // A tagged par is kept as it is; a par the map does not have (or has out
    // of range) is no card, unless the caller asked for an estimate.
    const tagged = typeof h.par === 'number' && h.par >= 3 && h.par <= 6;
    if (!tagged && !opts.estimate) return null;
    if (!Array.isArray(h.line) || h.line.length < 2) return null;
    const yards = Math.round(measureYards(h.line));
    if (!Number.isFinite(yards) || yards <= 0) return null;
    out.push(tagged
      ? { number: h.hole, par: h.par as number, yardage: { [MAP_TEE]: yards }, handicap: 0 }
      : { number: h.hole, par: estimatePar(yards), yardage: { [MAP_TEE]: yards }, handicap: 0, parEstimated: true });
  }
  return out;
}

/** At most this many pars may differ when a provider card replaces a map card:
 *  a real card can correct a mapper's slip, but a same-named different course
 *  disagrees on many holes. */
export const MAP_PAR_DIFF_MAX = 2;

/** May this provider card replace the course's map card? Same hole count and
 *  nearly the same pars. No map card to compare with: nothing to protect. */
export function sheetAgreesWithMap(
  provider: ReadonlyArray<{ number: number; par: number }>,
  map: ReadonlyArray<{ number: number; par: number }> | null
): boolean {
  if (!map) return true;
  if (provider.length !== map.length) return false;
  const pars = new Map(map.map(h => [h.number, h.par]));
  let differ = 0;
  for (const h of provider) {
    if (!pars.has(h.number)) return false;
    if (pars.get(h.number) !== h.par) differ++;
  }
  return differ <= MAP_PAR_DIFF_MAX;
}
