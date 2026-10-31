// ── The scorecard from the map (Oct 31 2026) — pure, zero imports ───────────
// Tom: "I see the yardage from the GPS and map when I go to play. So how do we
// not know the scorecard?" A course's stored hole lines carry OSM's par and a
// measurable tee-to-green length. When there is no provider card, that IS a
// card: pars plus one measured yardage per hole. Only when complete: exactly 9
// or 18 consecutive holes, each with a real par and a drawable line. Never a
// partial or guessed card, and never handicaps or ratings the map does not have.

export const MAP_TEE = 'map';

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
}

export function sheetFromGeometry(
  holes: ReadonlyArray<MapSheetLine> | null | undefined,
  measureYards: (line: ReadonlyArray<readonly [number, number]>) => number
): MapSheetHole[] | null {
  if (!Array.isArray(holes) || (holes.length !== 9 && holes.length !== 18)) return null;
  const sorted = [...holes].sort((a, b) => a.hole - b.hole);
  const out: MapSheetHole[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i];
    if (h.hole !== i + 1) return null;
    if (typeof h.par !== 'number' || h.par < 3 || h.par > 6) return null;
    if (!Array.isArray(h.line) || h.line.length < 2) return null;
    const yards = Math.round(measureYards(h.line));
    if (!Number.isFinite(yards) || yards <= 0) return null;
    out.push({ number: h.hole, par: h.par, yardage: { [MAP_TEE]: yards }, handicap: 0 });
  }
  return out;
}
