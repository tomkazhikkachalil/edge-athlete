// ── The hole in front of you (Golf hole-detail program PR D, Oct 2026) ──────
// ONE set of pure rules the live page's map chip and the scorer's hole header
// both read, so they can never disagree: the par / stroke-index / yardage
// ladder, the tee sheet, the live line (to the green, and what it plays
// like), the running score and the group's scores on a hole. Zero React.

import { greenDistanceYards, polylineYards } from '@/lib/golf/hole-geometry';
import { metresToYards, playsLikeYards, riseToGreen, type HoleElevationProfile } from '@/lib/golf/elevation';
import { courseTeeOptions, teeLabel } from '@/lib/golf/tees';
import type { CourseHole } from '@/types/golf';

export type LatLng = [number, number];

/** The round's own per-hole data (golf_scorecard_data.hole_data). */
export interface RoundHoleData {
  hole: number;
  par: number;
  yardage?: number;
  /** The stroke index (1..18) — carried by rounds created since PR D. */
  handicap?: number;
}

/** The catalog row's tee sheet (`?holes=1`'s `sheet`). */
export interface TeeSheetSource {
  holes: CourseHole[];
  courseRating: Record<string, number>;
  slopeRating: Record<string, number>;
}

export interface HoleHeaderFacts {
  par: number | null;
  /** The stroke index, or null when nobody recorded one. */
  hcp: number | null;
  yards: number | null;
  /** True when the yards are the drawn line's length, not the card's. */
  approx: boolean;
  /** "White" — the tee in play, when the round names one. */
  teeLabel: string | null;
}

const FALLBACK_ORDER = ['white', 'blue'] as const;

/** The catalog's yardage for this hole on the tee in play, with the
 *  composer's own fallback ladder (white → blue → any). */
function sheetYards(sheet: TeeSheetSource | null | undefined, hole: number, tee: string | null | undefined): number | null {
  const row = sheet?.holes.find(h => h.number === hole);
  if (!row || !row.yardage) return null;
  const keys = [tee ?? '', ...FALLBACK_ORDER, ...Object.keys(row.yardage)];
  for (const k of keys) {
    const y = k ? row.yardage[k] : undefined;
    if (typeof y === 'number' && Number.isFinite(y) && y > 0) return y;
  }
  return null;
}

/** The yardage / stroke-index ladder: the round's own hole_data first, the
 *  catalog's sheet second, the drawn line's length last (flagged approx).
 *  A catalog handicap of 0 means "unknown" (CourseScorecardTable's rule). */
export function holeHeaderFacts(input: {
  hole: number;
  holeData?: RoundHoleData[] | null;
  sheet?: TeeSheetSource | null;
  teeInPlay?: string | null;
  line?: LatLng[] | null;
  /** A par the caller already knows (the OSM line's), used last. */
  fallbackPar?: number | null;
}): HoleHeaderFacts {
  const round = input.holeData?.find(h => h.hole === input.hole) ?? null;
  const sheetRow = input.sheet?.holes.find(h => h.number === input.hole) ?? null;
  const cardYards = typeof round?.yardage === 'number' && round.yardage > 0 ? round.yardage : null;
  const catalogYards = cardYards ?? sheetYards(input.sheet, input.hole, input.teeInPlay);
  const approxYards = input.line && input.line.length >= 2 ? polylineYards(input.line) : null;
  const hcp =
    typeof round?.handicap === 'number' && round.handicap > 0
      ? round.handicap
      : typeof sheetRow?.handicap === 'number' && sheetRow.handicap > 0
        ? sheetRow.handicap
        : null;
  return {
    par: round?.par ?? sheetRow?.par ?? input.fallbackPar ?? null,
    hcp,
    yards: catalogYards ?? approxYards,
    approx: catalogYards == null && approxYards != null,
    teeLabel: input.teeInPlay ? teeLabel(input.teeInPlay) : null,
  };
}

export interface TeeRow {
  key: string;
  label: string;
  yards: number;
  rating: number | null;
  slope: number | null;
  inPlay: boolean;
}

/** Every tee's yardage on this hole with its rating / slope — hardest first
 *  (the tee-sheet convention), the tee in play first of all; a tee with no
 *  yardage on this hole is left out. */
export function teeSheetForHole(sheet: TeeSheetSource | null | undefined, hole: number, teeInPlay?: string | null): TeeRow[] {
  if (!sheet) return [];
  const row = sheet.holes.find(h => h.number === hole);
  if (!row || !row.yardage) return [];
  const order = courseTeeOptions({ courseRating: sheet.courseRating, slopeRating: sheet.slopeRating, holes: sheet.holes });
  const rows: TeeRow[] = [];
  for (const key of order) {
    const yards = row.yardage[key];
    if (typeof yards !== 'number' || !Number.isFinite(yards) || yards <= 0) continue;
    rows.push({
      key,
      label: teeLabel(key),
      yards,
      rating: typeof sheet.courseRating[key] === 'number' ? sheet.courseRating[key] : null,
      slope: typeof sheet.slopeRating[key] === 'number' ? sheet.slopeRating[key] : null,
      inPlay: !!teeInPlay && key === teeInPlay,
    });
  }
  rows.sort((a, b) => Number(b.inPlay) - Number(a.inPlay));
  return rows;
}

export interface LiveLine {
  /** gps = from where you stand; tee = from the tee; none = no line to measure. */
  kind: 'gps' | 'tee' | 'none';
  toGreen: number | null;
  /** The elevation-adjusted number, null without a profile. */
  playsLike: number | null;
  /** Yards the green sits above (+) or below (−) the origin; null without a profile. */
  riseYds: number | null;
}

/** The live line: with a fix, the distance from it to the green (the map's
 *  own rule, 1500 yd cap) and the rise read at the fix; without one, the
 *  card's yardage (else the drawn line) and the rise from the tee. */
export function liveLine(input: {
  fix?: LatLng | null;
  line?: LatLng[] | null;
  profile?: Pick<HoleElevationProfile, 'pts' | 'elev'> | null;
  cardYards?: number | null;
}): LiveLine {
  const line = input.line && input.line.length >= 2 ? input.line : null;
  if (!line) return { kind: 'none', toGreen: null, playsLike: null, riseYds: null };
  const fromFix = input.fix ? greenDistanceYards(input.fix, line) : null;
  const origin: LatLng = input.fix && fromFix != null ? input.fix : line[0];
  const toGreen = input.fix && fromFix != null ? fromFix : (input.cardYards ?? polylineYards(line));
  if (toGreen == null) return { kind: 'none', toGreen: null, playsLike: null, riseYds: null };
  const riseM = input.profile ? riseToGreen(input.profile, origin) : null;
  const riseYds = riseM == null ? null : metresToYards(riseM);
  return {
    kind: input.fix && fromFix != null ? 'gps' : 'tee',
    toGreen,
    playsLike: riseYds == null ? null : playsLikeYards(toGreen, riseYds),
    riseYds,
  };
}

/** The player's score so far: strokes over par through the holes PLAYED —
 *  `strokes === null` is the one "not played" signal and is skipped. */
export function runningToPar(holes: Array<{ strokes: number | null | undefined; par: number }>): { toPar: number; thru: number } | null {
  let toPar = 0;
  let thru = 0;
  for (const h of holes) {
    if (typeof h.strokes !== 'number' || h.strokes <= 0) continue;
    toPar += h.strokes - h.par;
    thru += 1;
  }
  return thru === 0 ? null : { toPar, thru };
}

export interface GroupPlayer {
  participantId: string;
  name: string;
  isSelf: boolean;
  holeScores: Array<{ hole_number: number; strokes: number | null }>;
}

/** The OTHER players' strokes on this hole, in the group's order; "You" for
 *  the viewer's own card when someone else's is open. */
export function groupScoresForHole(group: GroupPlayer[] | null | undefined, hole: number, activeParticipantId: string | null): Array<{ label: string; strokes: number }> {
  if (!group) return [];
  const out: Array<{ label: string; strokes: number }> = [];
  for (const p of group) {
    if (p.participantId === activeParticipantId) continue;
    const s = p.holeScores.find(h => h.hole_number === hole)?.strokes;
    if (typeof s !== 'number' || s <= 0) continue;
    out.push({ label: p.isSelf ? 'You' : p.name.split(' ')[0] || p.name, strokes: s });
  }
  return out;
}
