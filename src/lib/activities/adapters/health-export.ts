// ── Apple Watch, by way of a bridge app (fix round part 3, PR 3) — pure ─────
// Apple has no web or server API for Health data: something must run on the
// iPhone. The athlete's route (Tom, Oct 1 2026) is a third-party bridge app —
// Health Auto Export — whose "REST API" automation POSTs each workout as
// JSON to a URL the athlete pastes in: their personal upload link.
//
// This file turns that JSON into NormalizedActivity and NOTHING else: it does
// no I/O, trusts no total (the writer recomputes what the points can prove
// and keeps a device total only where plausible), and never guesses — a
// workout it cannot place in time is skipped and counted, an unknown workout
// name is `other`.
//
// The export format (the app's documented "Workouts v2" JSON, read Oct 1
// 2026; v1's `lat` / `lon` route keys are read too):
//
//   { "data": { "workouts": [ {
//       "id": "<uuid>", "name": "Outdoor Run",
//       "start": "2026-10-01 07:00:00 -0400", "end": "2026-10-01 07:42:10 -0400",
//       "duration": 2530,                                  // seconds
//       "distance": { "qty": 8.02, "units": "km" },
//       "activeEnergyBurned": { "qty": 612, "units": "kcal" },
//       "elevationUp": { "qty": 54, "units": "m" }, "elevationDown": { … },
//       "heartRateData": [ { "date": "…", "Avg": 152, "Min": 150, "Max": 155 } ],
//       "route": [ { "latitude": 43.65, "longitude": -79.38, "altitude": 91.2,
//                    "timestamp": "2026-10-01 07:00:01 -0400" } ]
//   } ] } }

import type { ActivityType } from '../catalog';
import type { ActivityPoint, DeviceTotals, NormalizedActivity } from '../types';

/** One delivery may carry a day's backlog; more than this is not a sync. */
export const MAX_WORKOUTS_PER_DELIVERY = 25;
/** Samples kept per workout (the import sheet's own ceiling). */
const MAX_POINTS = 10_000;
/** A heart-rate sample dresses the route point nearest to it within this. */
const HR_ATTACH_MS = 60_000;

export interface AdaptedActivity {
  activity: NormalizedActivity;
  /** The bridge app's own id for the workout — the dedupe key when present. */
  externalId: string | null;
}

export interface HealthExportParse {
  activities: AdaptedActivity[];
  /** Workouts that could not be read (no start, no end, not an object). */
  skipped: number;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** Whether a JSON body is this app's export (so the inbound route can tell
 *  it from anything else posted to the link). */
export function looksLikeHealthExport(body: unknown): boolean {
  return isObj(body) && isObj(body.data) && Array.isArray(body.data.workouts);
}

/**
 * The export's timestamps: "2026-10-01 07:00:00 -0400" (also read: an ISO
 * string, a "Z", a colon in the offset, fractional seconds). A timestamp
 * with NO offset is refused — guessing a zone moves the workout by hours.
 */
export function parseExportDate(v: unknown): { t: number; offsetMin: number } | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?\s*(Z|[+-]\d{2}:?\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  let offsetMin = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms) - offsetMin * 60_000;
  return Number.isFinite(utc) ? { t: utc, offsetMin } : null;
}

/**
 * Apple's workout names → our types. An explicit list, never a substring
 * guess over free text ("Stair Climbing" is not a climb, "Skating" is not
 * skiing): anything not named here is `other`, which Vitals still counts as
 * a session.
 */
const NAME_RULES: readonly [RegExp, ActivityType][] = [
  [/\btrail run(ning)?\b/, 'trail_run'],
  [/\b(run|running|jog|jogging)\b/, 'run'],
  [/\bmountain bik(e|ing)\b/, 'mountain_bike'],
  [/\b(cycle|cycling|bike|biking|ride)\b/, 'ride'],
  [/\b(hike|hiking)\b/, 'hike'],
  [/\b(walk|walking)\b/, 'walk'],
  [/\b(swim|swimming)\b/, 'swim'],
  [/\b(row|rowing|rower)\b/, 'row'],
  [/\b(ski|skiing|snowboard|snowboarding)\b/, 'ski'],
  [/^(rock |indoor |outdoor )?climbing$/, 'climb'],
];

export function workoutType(name: unknown): ActivityType {
  if (typeof name !== 'string') return 'other';
  const n = name.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  for (const [re, type] of NAME_RULES) if (re.test(n)) return type;
  return 'other';
}

/** `{ qty, units }` → metres. Unknown units are dropped, never assumed. */
function metres(v: unknown): number | undefined {
  if (!isObj(v)) return undefined;
  const qty = num(v.qty);
  if (qty === undefined || qty < 0) return undefined;
  switch (String(v.units ?? '').toLowerCase()) {
    case 'km': return qty * 1000;
    case 'mi': return qty * 1609.344;
    case 'm': return qty;
    case 'ft': return qty * 0.3048;
    case 'yd': return qty * 0.9144;
    default: return undefined;
  }
}

function kcal(v: unknown): number | undefined {
  if (!isObj(v)) return undefined;
  const qty = num(v.qty);
  if (qty === undefined || qty < 0) return undefined;
  switch (String(v.units ?? '').toLowerCase()) {
    case 'kcal': case 'cal': return qty; // the app writes dietary calories either way
    case 'kj': return qty / 4.184;
    default: return undefined;
  }
}

function routePoints(route: unknown): ActivityPoint[] {
  if (!Array.isArray(route)) return [];
  const out: ActivityPoint[] = [];
  for (const r of route) {
    if (!isObj(r)) continue;
    const at = parseExportDate(r.timestamp ?? r.date);
    const lat = num(r.latitude ?? r.lat);
    const lng = num(r.longitude ?? r.lon ?? r.lng);
    if (!at || lat === undefined || lng === undefined) continue;
    const p: ActivityPoint = { t: at.t, lat, lng };
    const ele = num(r.altitude);
    if (ele !== undefined) p.ele = ele;
    out.push(p);
  }
  return out.sort((a, b) => a.t - b.t);
}

function heartRate(samples: unknown): { t: number; hr: number }[] {
  if (!Array.isArray(samples)) return [];
  const out: { t: number; hr: number }[] = [];
  for (const s of samples) {
    if (!isObj(s)) continue;
    const at = parseExportDate(s.date ?? s.timestamp);
    const hr = num(s.Avg ?? s.avg ?? s.qty);
    if (at && hr !== undefined) out.push({ t: at.t, hr });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Keep at most `max` items, evenly by index, always keeping both ends. */
function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}

/** One workout → one activity, or null when it cannot be placed in time. */
export function adaptWorkout(w: unknown): AdaptedActivity | null {
  if (!isObj(w)) return null;
  const start = parseExportDate(w.start);
  const duration = num(w.duration);
  const endParsed = parseExportDate(w.end);
  const endT = endParsed?.t ?? (start && duration !== undefined && duration > 0 ? start.t + duration * 1000 : undefined);
  if (!start || endT === undefined || endT <= start.t) return null;

  const inWindow = (t: number) => t >= start.t - 1000 && t <= endT + 1000;
  const route = thin(routePoints(w.route).filter(p => inWindow(p.t)), MAX_POINTS);
  const hrs = heartRate(w.heartRateData).filter(s => inWindow(s.t));

  let points: ActivityPoint[];
  if (route.length >= 2) {
    // The route is the timeline; each fix takes the heart rate nearest to it.
    points = route;
    let j = 0;
    for (const p of points) {
      while (j + 1 < hrs.length && Math.abs(hrs[j + 1].t - p.t) <= Math.abs(hrs[j].t - p.t)) j++;
      if (hrs.length > 0 && Math.abs(hrs[j].t - p.t) <= HR_ATTACH_MS) p.hr = hrs[j].hr;
    }
  } else {
    // No route (a treadmill, a gym session, a pool): the heart rate is the timeline.
    points = thin(hrs, MAX_POINTS).map(s => ({ t: s.t, hr: s.hr }));
  }
  // The workout's own start and end bound it, so its length is the watch's —
  // not the first and last sample's.
  if (points.length === 0 || points[0].t > start.t) points.unshift({ t: start.t });
  if (points[points.length - 1].t < endT) points.push({ t: endT });

  const device: DeviceTotals = {};
  const distanceM = metres(w.distance);
  if (distanceM !== undefined) device.distanceM = distanceM;
  if (duration !== undefined && duration > 0) device.elapsedS = duration;
  const gain = metres(w.elevationUp);
  if (gain !== undefined) device.elevGainM = gain;
  const loss = metres(w.elevationDown);
  if (loss !== undefined) device.elevLossM = loss;
  const energy = kcal(w.activeEnergyBurned ?? w.activeEnergy);
  if (energy !== undefined) device.calories = energy;

  const id = typeof w.id === 'string' && /^[A-Za-z0-9._:-]{8,100}$/.test(w.id.trim()) ? w.id.trim() : null;
  return {
    activity: {
      format: null,
      type: workoutType(w.name),
      // Apple's name is the TYPE ("Outdoor Run"), not a title: the writer's
      // own default ("Morning run") reads better and matches a file import.
      name: null,
      points,
      device,
      tzOffsetMin: start.offsetMin,
    },
    externalId: id,
  };
}

/** A whole delivery. Never throws: an unreadable workout is counted, the rest go through. */
export function parseHealthExport(body: unknown): HealthExportParse {
  if (!looksLikeHealthExport(body)) return { activities: [], skipped: 0 };
  const workouts = ((body as Json).data as Json).workouts as unknown[];
  const activities: AdaptedActivity[] = [];
  let skipped = 0;
  for (const w of workouts.slice(0, MAX_WORKOUTS_PER_DELIVERY)) {
    const adapted = adaptWorkout(w);
    if (adapted) activities.push(adapted);
    else skipped++;
  }
  skipped += Math.max(0, workouts.length - MAX_WORKOUTS_PER_DELIVERY);
  return { activities, skipped };
}
