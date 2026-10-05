// ── An activity becomes a sport result — the share-time bridge (Oct 4 2026) ─
// Tom: "a bike ride could also be considered a sport, same as swimming" — a
// recorded ride, swim, run or row is a Vitals session AND, when the athlete
// chooses so at share time, a result in the sport's own tab and the
// performance dataset. The bridge is a CHOICE on share, never automatic: an
// activity stays "not a sport" until it is posted as one. Pure: which sport an
// activity type maps to, and the stat line (stat-schemas.ts enduranceSchema)
// built from the activity's row — validated by the server like any stat line,
// turned into the performance row by fromStatLinePost.

import type { SportKey } from '@/lib/sports/SportRegistry';
import type { StatLineData } from '@/lib/sports/stat-schemas';
import type { ActivityType } from './catalog';

/** The sport a recorded activity may be posted as; types not listed stay training only. */
export const SPORT_FOR_ACTIVITY_TYPE: Readonly<Partial<Record<ActivityType, SportKey>>> = {
  swim: 'swimming',
  open_water_swim: 'swimming',
  ride: 'cycling',
  mountain_bike: 'cycling',
  indoor_ride: 'cycling',
  run: 'running',
  trail_run: 'running',
  treadmill: 'running',
  row: 'rowing',
};

export function sportForActivity(type: ActivityType): SportKey | null {
  return SPORT_FOR_ACTIVITY_TYPE[type] ?? null;
}

export interface EnduranceSource {
  activity_type: ActivityType;
  occurred_on: string;
  name: string;
  distance_m: number | null;
  moving_s: number | null;
  elapsed_s: number;
  elev_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  avg_power: number | null;
  calories: number | null;
}

const r = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

/** The sport's stat line from an activity's row, or null when the type maps to no sport or the row has no distance. */
export function buildEnduranceStatLine(a: EnduranceSource): StatLineData | null {
  const sport = sportForActivity(a.activity_type);
  if (!sport) return null;
  if (a.distance_m === null || !(a.distance_m > 0)) return null;
  const water = sport === 'swimming' || sport === 'rowing';
  const time = a.moving_s && a.moving_s > 0 ? a.moving_s : a.elapsed_s;
  const stats: Record<string, number> = {};
  if (water) stats.distance_m = Math.round(a.distance_m);
  else stats.distance_km = r(a.distance_m / 1000, 2);
  if (a.moving_s !== null && a.moving_s > 0) stats.moving_s = Math.round(a.moving_s);
  if (a.elapsed_s > 0) stats.elapsed_s = Math.round(a.elapsed_s);
  if (time > 0) {
    if (sport === 'swimming') stats.pace_s_per_100m = r((time / a.distance_m) * 100, 2);
    else stats.pace_s_per_km = r((time / a.distance_m) * 1000, 2);
  }
  if (a.elev_gain_m !== null && a.elev_gain_m > 0) stats.elev_gain_m = Math.round(a.elev_gain_m);
  if (a.avg_hr !== null && a.avg_hr >= 20) stats.avg_hr = Math.round(a.avg_hr);
  if (a.max_hr !== null && a.max_hr >= 20) stats.max_hr = Math.round(a.max_hr);
  if (a.avg_cadence !== null && a.avg_cadence > 0) stats.avg_cadence = Math.round(a.avg_cadence);
  if (a.calories !== null && a.calories > 0) stats.calories = Math.round(a.calories);
  if (sport === 'cycling' && a.avg_power !== null && a.avg_power > 0) stats.avg_power = Math.round(a.avg_power);
  return { type: 'stat_line', sport_key: sport, date: a.occurred_on, opponent: a.name.slice(0, 80), stats };
}
