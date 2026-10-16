// ── Which numbers an activity shows, per type — pure (Oct 16 2026) ──────────
// Before this, every activity showed the same four tiles (Distance, Moving
// time, pace, Elevation gain), so a yoga session read "0 km · — /km". Now
// each type family names its own tiles, in order, and a tile appears ONLY
// when it has a value (Tom's review, Oct 16): no "—" placeholders, no heart
// rate tile while the watch connections are paused. The detail page shows
// up to MAX_TILES; the feed card and the profile list take the first few.

import { ACTIVITY_TYPE_DEFS, type ActivityType } from './catalog';
import type { Derived } from './derived';
import { poolOf, type Details } from './details';
import { lengths } from './pool';
import { formatDistance, formatDuration, formatElevation, formatPace, formatSpeed, paceMetres, paceSuffix, type DistanceUnit } from './format';

/** Everything a tile can read. The feed card fills only what its snapshot holds. */
export interface TileSource {
  type: ActivityType;
  distanceM: number | null;
  movingS: number | null;
  elapsedS: number;
  elevGainM: number | null;
  elevLossM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgPower: number | null;
  avgCadence: number | null;
  calories: number | null;
  steps: number | null;
  stepsSource: 'estimated' | 'device' | null;
  /** 265: how hard it felt, and the type's answers (details.ts) — absent on a card written before. */
  effort?: number | null;
  details?: Details;
}

export interface Tile {
  key: TileKey;
  label: string;
  value: string;
}

export type TileKey =
  | 'distance'
  | 'time'
  | 'moving'
  | 'total'
  | 'pace'
  | 'gap'
  | 'gain'
  | 'loss'
  | 'descent'
  | 'high'
  | 'climbRate'
  | 'runs'
  | 'maxSpeed'
  | 'hr'
  | 'power'
  | 'cadence'
  | 'calories'
  | 'steps'
  | 'effort'
  | 'lengths';

/** The detail page's ceiling: five rows of two at 375 px. */
export const MAX_TILES = 9;

type Family = 'foot' | 'trail' | 'wheel' | 'snow' | 'water' | 'indoor' | 'session';

/** Each type's family — the order its tiles read in. */
export const TILE_FAMILY: Readonly<Record<ActivityType, Family>> = {
  run: 'foot',
  walk: 'foot',
  treadmill: 'indoor',
  trail_run: 'trail',
  hike: 'trail',
  xc_ski: 'trail',
  ride: 'wheel',
  mountain_bike: 'wheel',
  skate: 'wheel',
  ski: 'snow',
  snowboard: 'snow',
  open_water_swim: 'water',
  paddle: 'water',
  swim: 'indoor',
  row: 'indoor',
  indoor_ride: 'indoor',
  elliptical: 'indoor',
  stair_climber: 'indoor',
  yoga: 'session',
  pilates: 'session',
  stretch: 'session',
  hiit: 'session',
  martial_arts: 'session',
  dance: 'session',
  climb: 'session',
  other: 'session',
  sport_session: 'session',
};

const TILE_ORDER: Readonly<Record<Family, readonly TileKey[]>> = {
  foot: ['distance', 'moving', 'pace', 'gain', 'effort', 'total', 'hr', 'cadence', 'steps', 'calories'],
  trail: ['distance', 'moving', 'pace', 'gap', 'gain', 'loss', 'high', 'climbRate', 'effort', 'total', 'hr', 'steps', 'calories'],
  wheel: ['distance', 'moving', 'pace', 'maxSpeed', 'gain', 'descent', 'effort', 'total', 'hr', 'power', 'cadence', 'calories'],
  snow: ['distance', 'moving', 'descent', 'runs', 'maxSpeed', 'effort', 'total', 'hr', 'calories'],
  water: ['distance', 'moving', 'pace', 'maxSpeed', 'effort', 'total', 'hr', 'calories'],
  indoor: ['distance', 'time', 'pace', 'lengths', 'effort', 'hr', 'power', 'cadence', 'steps', 'calories'],
  session: ['time', 'effort', 'hr', 'calories'],
};

/** Types whose moving and total time are both worth showing (breaks matter). */
const ALWAYS_TOTAL: ReadonlySet<ActivityType> = new Set<ActivityType>(['hike', 'ride', 'mountain_bike']);

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function cadenceUnit(type: ActivityType): string {
  const family = TILE_FAMILY[type];
  if (type === 'row') return 'spm';
  return family === 'wheel' || type === 'indoor_ride' ? 'rpm' : 'spm';
}

/** One tile, or null when it has nothing to say. */
function tile(key: TileKey, src: TileSource, derived: Derived | null, unit: DistanceUnit): Tile | null {
  const moving = src.movingS ?? src.elapsedS;
  switch (key) {
    case 'distance':
      return isNum(src.distanceM) && src.distanceM > 0 ? { key, label: 'Distance', value: formatDistance(src.distanceM, unit) } : null;
    case 'time':
      return { key, label: 'Time', value: formatDuration(moving) };
    case 'moving':
      // A recording the filter never saw move has no moving time worth a tile (the total still shows).
      return moving > 0 ? { key, label: 'Moving time', value: formatDuration(moving) } : null;
    case 'total': {
      if (!isNum(src.movingS)) return null;
      if (src.movingS === 0) return { key, label: 'Total time', value: formatDuration(src.elapsedS) };
      const gap = src.elapsedS - src.movingS;
      const show = ALWAYS_TOTAL.has(src.type) ? gap > 0 : gap > 60;
      return show ? { key, label: 'Total time', value: formatDuration(src.elapsedS) } : null;
    }
    case 'pace': {
      if (!isNum(src.distanceM) || src.distanceM <= 0 || moving <= 0) return null;
      return { key, ...formatPace(src.distanceM, moving, src.type, unit) };
    }
    case 'gap': {
      const per = paceMetres(src.type, unit);
      const adj = derived?.gradeAdjustedM ?? null;
      if (per === null || !isNum(adj) || adj <= 0 || moving <= 0) return null;
      return { key, label: 'Grade-adjusted pace', value: `${formatDuration((moving / adj) * per)} ${paceSuffix(src.type, unit)}` };
    }
    case 'gain':
      return isNum(src.elevGainM) && src.elevGainM > 0 ? { key, label: 'Elevation gain', value: formatElevation(src.elevGainM, unit) } : null;
    case 'loss':
      return isNum(src.elevLossM) && src.elevLossM > 0 ? { key, label: 'Elevation loss', value: formatElevation(src.elevLossM, unit) } : null;
    case 'descent':
      return isNum(src.elevLossM) && src.elevLossM > 0 ? { key, label: 'Descent', value: formatElevation(src.elevLossM, unit) } : null;
    case 'high': {
      const h = derived?.maxElevationM ?? null;
      return isNum(h) ? { key, label: 'High point', value: formatElevation(h, unit) } : null;
    }
    case 'climbRate': {
      const r = derived?.climbRateMph ?? null;
      if (!isNum(r)) return null;
      return { key, label: 'Climb rate', value: unit === 'mi' ? `${Math.round(r * 3.28084)} ft/h` : `${r} m/h` };
    }
    case 'runs':
      return derived && derived.runs > 0 ? { key, label: 'Runs', value: `${derived.runs}` } : null;
    case 'maxSpeed': {
      const v = derived?.maxSpeedMps ?? null;
      return isNum(v) ? { key, label: 'Max speed', value: formatSpeed(v, unit) } : null;
    }
    case 'hr':
      if (!isNum(src.avgHr)) return null;
      return { key, label: 'Heart rate', value: isNum(src.maxHr) && src.maxHr > src.avgHr ? `${src.avgHr} bpm · max ${src.maxHr}` : `${src.avgHr} bpm` };
    case 'power':
      return isNum(src.avgPower) ? { key, label: 'Avg power', value: `${src.avgPower} W` } : null;
    case 'cadence':
      return isNum(src.avgCadence) ? { key, label: 'Cadence', value: `${src.avgCadence} ${cadenceUnit(src.type)}` } : null;
    case 'calories':
      return isNum(src.calories) ? { key, label: 'Calories', value: `${src.calories}` } : null;
    case 'effort':
      return isNum(src.effort) ? { key, label: 'Effort', value: `${src.effort} / 10` } : null;
    case 'lengths': {
      const n = lengths(src.distanceM, src.details ? poolOf(src.details) : null);
      return n !== null ? { key, label: 'Lengths', value: `${n}` } : null;
    }
    case 'steps':
      return isNum(src.steps) ? { key, label: src.stepsSource === 'device' ? 'Steps' : 'Steps (est.)', value: `~${src.steps.toLocaleString()}` } : null;
  }
}

/** The type's tiles, in its order, only those with a value, at most `max`. */
export function tilesFor(src: TileSource, derived: Derived | null, unit: DistanceUnit, max = MAX_TILES): Tile[] {
  const out: Tile[] = [];
  for (const key of TILE_ORDER[TILE_FAMILY[src.type]]) {
    const t = tile(key, src, derived, unit);
    if (t) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** True when the type reads a speed rather than a pace (chart axis, table header). */
export function readsSpeed(type: ActivityType): boolean {
  return ACTIVITY_TYPE_DEFS[type].paceStyle === 'speed';
}
