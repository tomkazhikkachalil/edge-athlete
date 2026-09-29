// ── The ONE normalized activity shape (Activities program) — pure ──────────
// Every source — a .GPX / .TCX parsed in the browser, a .FIT decoded on the
// server, later a Strava / Google Health / Garmin delivery — becomes a
// NormalizedActivity, and nothing downstream (the writer, the summary, the
// readers, the screens) ever learns a provider's format. docs/ACTIVITIES.md
// is the reference.

import type { ActivityType } from './catalog';

export type SourceFormat = 'fit' | 'gpx' | 'tcx';

/** One sample. `t` is epoch milliseconds; everything else optional because
 *  every device records a different subset (an indoor ride has no fix, a
 *  phone has no heart rate). */
export interface ActivityPoint {
  t: number;
  lat?: number;
  lng?: number;
  /** metres above sea level */
  ele?: number;
  /** beats per minute */
  hr?: number;
  /** steps or revolutions per minute */
  cad?: number;
  /** watts */
  pwr?: number;
  /** the device's own cumulative distance (m), when it records one */
  dist?: number;
}

/** What the device itself reported (a FIT session, a TCX lap sum). Kept
 *  only where plausible against what the points say (normalize.ts). */
export interface DeviceTotals {
  distanceM?: number;
  elapsedS?: number;
  movingS?: number;
  elevGainM?: number;
  elevLossM?: number;
  calories?: number;
}

export interface NormalizedActivity {
  format: SourceFormat;
  type: ActivityType;
  /** The file's own name for it, if any ("Morning Run"). */
  name: string | null;
  points: ActivityPoint[];
  device: DeviceTotals;
  /** Minutes east of UTC at the start, when the file says (FIT's
   *  local_timestamp); null → the uploader's time zone decides the date. */
  tzOffsetMin: number | null;
}

/** The totals the SERVER computes (never the client's). */
export interface ActivitySummary {
  startedAt: number;
  elapsedS: number;
  movingS: number | null;
  distanceM: number | null;
  elevGainM: number | null;
  elevLossM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgPower: number | null;
  avgCadence: number | null;
  calories: number | null;
  hasRoute: boolean;
}

/** The stored stream (storage, gzipped JSON): columnar, at most
 *  DISPLAY_POINTS samples, aligned by index. `s` is seconds from the start,
 *  `d` cumulative metres. A column the device never recorded is absent. */
export interface ActivityStream {
  v: 1;
  s: number[];
  d: number[];
  lat?: (number | null)[];
  lng?: (number | null)[];
  ele?: (number | null)[];
  hr?: (number | null)[];
  cad?: (number | null)[];
  pwr?: (number | null)[];
}

export interface Split {
  /** 1-based; the last split may be partial. */
  index: number;
  distanceM: number;
  seconds: number;
  elevChangeM: number | null;
  avgHr: number | null;
}
