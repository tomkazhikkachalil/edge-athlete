// ── The activity page's chart series — pure ────────────────────────────────
// Each chart is distance on x and one column on y. Pace is derived: a
// speed over a short window either side of the sample (GPS noise at 1 Hz
// makes a sample-to-sample pace unreadable), null while stopped.

import { ACTIVITY_TYPE_DEFS, type ActivityType } from './catalog';
import { UNIT_METRES, type DistanceUnit } from './format';
import type { ActivityStream } from './types';

export type ChartKind = 'elevation' | 'hr' | 'pace';

export interface ChartSeries {
  kind: ChartKind;
  title: string;
  /** metres along the route */
  x: number[];
  y: (number | null)[];
  /** Pace reads better upside down (faster is higher). */
  invert: boolean;
  color: string;
}

const FEET_PER_M = 3.28084;

export function paceSeries(stream: ActivityStream, type: ActivityType, unit: DistanceUnit, halfWindow = 5): (number | null)[] {
  const { s, d } = stream;
  const def = ACTIVITY_TYPE_DEFS[type];
  const per = def.paceStyle === 'swim_pace' ? 100 : UNIT_METRES[unit];
  return d.map((_, i) => {
    const a = Math.max(0, i - halfWindow);
    const b = Math.min(d.length - 1, i + halfWindow);
    const dt = s[b] - s[a];
    const dd = d[b] - d[a];
    if (dt <= 0 || dd <= 0) return null;
    const speed = dd / dt;
    if (speed < def.movingSpeed) return null;
    return def.paceStyle === 'speed' ? speed * 3.6 * (unit === 'mi' ? 1 / 1.609344 : 1) : per / speed;
  });
}

/** The charts this stream can draw, in page order. */
export function chartSeries(stream: ActivityStream | null, type: ActivityType, unit: DistanceUnit): ChartSeries[] {
  if (!stream || stream.d.length < 2) return [];
  const out: ChartSeries[] = [];
  const has = (col?: (number | null)[]) => !!col && col.filter(v => v !== null).length >= 2;
  if (has(stream.ele)) {
    out.push({
      kind: 'elevation',
      title: 'Elevation',
      x: stream.d,
      y: stream.ele!.map(v => (v === null ? null : unit === 'mi' ? v * FEET_PER_M : v)),
      invert: false,
      color: '#7c3aed',
    });
  }
  if (stream.d[stream.d.length - 1] > 0) {
    const pace = paceSeries(stream, type, unit);
    if (pace.filter(v => v !== null).length >= 2) {
      const speed = ACTIVITY_TYPE_DEFS[type].paceStyle === 'speed';
      out.push({ kind: 'pace', title: speed ? 'Speed' : 'Pace', x: stream.d, y: pace, invert: !speed, color: '#0284c7' });
    }
  }
  if (has(stream.hr)) out.push({ kind: 'hr', title: 'Heart rate', x: stream.d, y: stream.hr!, invert: false, color: '#dc2626' });
  return out;
}
