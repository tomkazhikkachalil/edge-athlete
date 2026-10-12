// ── Where the drawn route breaks (resume pill program, Oct 12 2026) — pure ──
// Tom: "the route will have a gap for that time … draw the gap as a straight
// dashed line." The recorder keeps the spans the app could not record
// (recording.ts `gaps`: the page hidden, the app closed, the phone locked).
// The live map draws the route as RUNS of solid line, one per stretch the
// phone was tracking, and a dashed BRIDGE across each gap — the straight
// line between the last fix before it and the first after. A user's own
// Pause is not a gap here (the spec names the closed app); it draws as today.

import type { ActivityPoint } from '../types';
import type { LatLng } from '../polyline';
import type { RecordingGap } from './recording';

/** True when a recorded gap (of any length above zero) overlaps the stretch between two consecutive fixes — no fix arrives while the app is away, so the gap sits between the two. */
export function gapBetween(prev: { t: number }, next: { t: number }, gaps: readonly RecordingGap[]): boolean {
  for (const g of gaps) {
    const to = g.toMs ?? Number.POSITIVE_INFINITY;
    if (to <= g.fromMs) continue;
    if (g.fromMs < next.t && to > prev.t) return true;
  }
  return false;
}

export interface RouteRuns {
  /** Solid stretches, in order (positioned fixes only). */
  runs: LatLng[][];
  /** One dashed line per break: the end of a run to the start of the next. */
  bridges: Array<[LatLng, LatLng]>;
}

/** The whole route as runs and bridges — what the map draws when it has to draw everything at once (a restore). */
export function splitAtGaps(points: readonly ActivityPoint[], gaps: readonly RecordingGap[]): RouteRuns {
  const runs: LatLng[][] = [];
  const bridges: Array<[LatLng, LatLng]> = [];
  let run: LatLng[] = [];
  let prev: ActivityPoint | null = null;
  for (const p of points) {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
    if (prev && run.length > 0 && gapBetween(prev, p, gaps)) {
      runs.push(run);
      bridges.push([run[run.length - 1], [p.lat, p.lng]]);
      run = [];
    }
    run.push([p.lat, p.lng]);
    prev = p;
  }
  if (run.length > 0) runs.push(run);
  return { runs, bridges };
}
