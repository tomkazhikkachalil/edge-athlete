// ── The hole in front of you (Golf hole-detail program PR D, Oct 2026) ──────
// ONE set of pure rules the live page's map chip and the scorer's hole header
// both read, so they can never disagree: the par / stroke-index / yardage
// ladder, the tee sheet, the live line (to the green, and what it plays
// like), the running score and the group's scores on a hole. Zero React.

import { greenDistanceYards, polylineYards } from '@/lib/golf/hole-geometry';
import { greenDistances, nearestGreen, type Ring } from '@/lib/golf/green';
import { formatRise, metresToYards, playsLikeYards, riseToGreen, type HoleElevationProfile } from '@/lib/golf/elevation';
import { COPY } from '@/lib/copy';
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
  /** gps = from where you stand; tee = from the tee; nearest = from where you
   *  stand to the NEAREST unnumbered green (greens-only, PR 3); none = nothing
   *  to measure. */
  kind: 'gps' | 'tee' | 'nearest' | 'none';
  /** To the CENTRE of the green (the outline's centroid when one exists,
   *  else the line's last point). */
  toGreen: number | null;
  /** To the front edge of the green — only from a fix, only with an
   *  outline, never while standing on the green (PR G3). */
  front: number | null;
  /** To the back edge — the same rule. */
  back: number | null;
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
  /** The green's outline (PR G3): the centre becomes its centroid and a fix
   *  gets the front / back edges too. */
  green?: Ring | null;
  /** The course's UNNUMBERED greens (greens-only, PR 3): with no line and
   *  no numbered green, a fix measures to the nearest of them. */
  nearestRings?: Ring[] | null;
}): LiveLine {
  const none: LiveLine = { kind: 'none', toGreen: null, front: null, back: null, playsLike: null, riseYds: null };
  const line = input.line && input.line.length >= 2 ? input.line : null;
  if (!line) {
    // No line to walk: a numbered green still has a centre and edges from a
    // fix (never from a tee — there is none); otherwise the nearest ring.
    if (!input.fix) return none;
    if (input.green) {
      const d = greenDistances(input.fix, input.green);
      if (!d || d.centre > 1500) return none;
      return { kind: 'gps', toGreen: d.centre, front: d.front, back: d.back, playsLike: null, riseYds: null };
    }
    if (input.nearestRings?.length) {
      const n = nearestGreen(input.fix, input.nearestRings);
      if (!n || n.distances.centre > 1500) return none;
      return { kind: 'nearest', toGreen: n.distances.centre, front: n.distances.front, back: n.distances.back, playsLike: null, riseYds: null };
    }
    return none;
  }
  const fromFix = input.fix ? greenDistanceYards(input.fix, line, 1500, input.green) : null;
  const gps = !!input.fix && fromFix != null;
  const origin: LatLng = gps ? input.fix! : line[0];
  const toGreen = gps ? fromFix : (input.cardYards ?? polylineYards(line));
  if (toGreen == null) return none;
  const edges = gps && input.green ? greenDistances(input.fix!, input.green) : null;
  const riseM = input.profile ? riseToGreen(input.profile, origin) : null;
  const riseYds = riseM == null ? null : metresToYards(riseM);
  return {
    kind: gps ? 'gps' : 'tee',
    toGreen,
    front: edges?.front ?? null,
    back: edges?.back ?? null,
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

// ── The strings the pill, the chip and the scorer share (M2, Oct 2026) ──────
// ONE spelling of the live distance everywhere: "F 182 · C 196 · B 207" when
// a green outline gives the edges, "196 yds to green" otherwise; and ONE
// spelling of the plays-like beside it. The chip pairs the LIVE distance
// with the live plays-like (PR F paired the card's yardage with a GPS
// plays-like — two origins on one line).

/** The live distance line, or null without a number. */
export function greenLabel(live: LiveLine): string | null {
  if (live.toGreen == null) return null;
  const trio = live.front != null && live.back != null;
  if (live.kind === 'nearest') {
    return `${COPY.GOLF_HOLE.NEAREST_GREEN} · ${trio ? COPY.GOLF_HOLE.FCB(live.front!, live.toGreen, live.back!) : `${live.toGreen} yds`}`;
  }
  if (trio) return COPY.GOLF_HOLE.FCB(live.front!, live.toGreen, live.back!);
  return COPY.GOLF_HOLE.TO_GREEN(live.toGreen);
}

/** "≈203 (↑ 7 yd)" — the short form beside a distance; null without a profile. */
export function playsLikeShort(live: LiveLine): string | null {
  if (live.playsLike == null) return null;
  const rise = formatRise(live.riseYds);
  return `≈${live.playsLike}${rise ? ` (${rise})` : ''}`;
}

export interface ChipDistanceLines {
  /** The distance line: the LIVE one with a fix, the card's yardage otherwise. */
  distance: string | null;
  /** "plays like ≈203 ↑ 7 yd" — the chip's long form (its e2e idiom). */
  playsLike: string | null;
  source: 'gps' | 'card' | 'approx' | null;
  /** True when the distance line is the front / centre / back trio. */
  fcb: boolean;
  /** The rise in whole yards, for the data hook; null without a profile. */
  riseYds: number | null;
}

/** What the map chip prints under "Hole N · Par P": with a fix, the live
 *  distance (never the card's yards) and the live plays-like; without one,
 *  the card's yards (≈ when drawn) and the tee-based plays-like. */
export function chipDistanceLines(facts: Pick<HoleHeaderFacts, 'yards' | 'approx'>, live: LiveLine): ChipDistanceLines {
  const rise = formatRise(live.riseYds);
  const playsLike = live.playsLike != null ? `${COPY.GOLF_HOLE.PLAYS_LIKE(live.playsLike)}${rise ? ` ${rise}` : ''}` : null;
  const riseYds = live.riseYds == null ? null : Math.round(live.riseYds);
  if ((live.kind === 'gps' || live.kind === 'nearest') && live.toGreen != null) {
    return { distance: greenLabel(live), playsLike, source: 'gps', fcb: live.front != null && live.back != null, riseYds };
  }
  if (facts.yards != null) {
    return { distance: `${facts.approx ? '≈' : ''}${facts.yards} yds`, playsLike, source: facts.approx ? 'approx' : 'card', fcb: false, riseYds };
  }
  return { distance: null, playsLike, source: null, fcb: false, riseYds };
}
