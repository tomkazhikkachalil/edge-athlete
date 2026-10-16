// ── How an activity's numbers read on screen — pure, client-safe ───────────
// One place for distance, time, pace / speed and elevation in km or miles,
// so the feed card, the tab and the page never disagree. The unit is the
// VIEWER's choice (remembered on their device, km by default).

import { ACTIVITY_TYPE_DEFS, type ActivityType } from './catalog';

export type DistanceUnit = 'km' | 'mi';
export const UNIT_METRES: Readonly<Record<DistanceUnit, number>> = { km: 1000, mi: 1609.344 };
const FEET_PER_M = 3.28084;

export function formatDistance(m: number | null, unit: DistanceUnit): string {
  if (m === null || !Number.isFinite(m)) return '—';
  const v = m / UNIT_METRES[unit];
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(2)} ${unit}`;
}

/** 1:02:03, 12:05, 0:45 */
export function formatDuration(s: number | null): string {
  if (s === null || !Number.isFinite(s) || s < 0) return '—';
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

export function formatElevation(m: number | null, unit: DistanceUnit): string {
  if (m === null || !Number.isFinite(m)) return '—';
  return unit === 'mi' ? `${Math.round(m * FEET_PER_M)} ft` : `${Math.round(m)} m`;
}

/** The metres a pace is read over: 100 for a swim, 500 for a row, the
 *  viewer's km or mile otherwise. Null for a speed type. */
export function paceMetres(type: ActivityType, unit: DistanceUnit): number | null {
  const style = ACTIVITY_TYPE_DEFS[type].paceStyle;
  if (style === 'speed') return null;
  if (style === 'swim_pace') return 100;
  if (style === 'pace_500m') return 500;
  return UNIT_METRES[unit];
}

/** What follows a value: "/km", "/100m", "/500m", or "km/h" / "mph" for a speed. */
export function paceSuffix(type: ActivityType, unit: DistanceUnit): string {
  const style = ACTIVITY_TYPE_DEFS[type].paceStyle;
  if (style === 'speed') return unit === 'km' ? 'km/h' : 'mph';
  if (style === 'swim_pace') return '/100m';
  if (style === 'pace_500m') return '/500m';
  return `/${unit}`;
}

/** A speed in m/s, in the viewer's unit: "32.4 km/h". */
export function formatSpeed(mps: number | null, unit: DistanceUnit): string {
  if (mps === null || !Number.isFinite(mps) || mps <= 0) return '—';
  return `${((mps * 3600) / UNIT_METRES[unit]).toFixed(1)} ${unit === 'km' ? 'km/h' : 'mph'}`;
}

/** The type's own speed reading: a pace (per km/mi, 100 m or 500 m) or a speed. */
export function formatPace(distanceM: number | null, seconds: number | null, type: ActivityType, unit: DistanceUnit): { label: string; value: string } {
  const per = paceMetres(type, unit);
  const label = per === null ? 'Avg speed' : 'Avg pace';
  if (!distanceM || !seconds || distanceM <= 0 || seconds <= 0) return { label, value: '—' };
  if (per === null) return { label, value: formatSpeed(distanceM / seconds, unit) };
  return { label, value: `${formatDuration((seconds / distanceM) * per)} ${paceSuffix(type, unit)}` };
}

/** "Sun, Sep 20 · 7:00 AM" in the activity's own zone when known. */
export function formatStart(startedAt: string, timeZone: string | null): string {
  const d = new Date(startedAt);
  if (!Number.isFinite(d.getTime())) return '';
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  try {
    return new Intl.DateTimeFormat(undefined, timeZone ? { ...opts, timeZone } : opts).format(d).replace(/,(?=[^,]*$)/, ' ·');
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(d);
  }
}

const UNIT_KEY = 'ea.activities.unit';

export function readUnitPreference(): DistanceUnit {
  try {
    return localStorage.getItem(UNIT_KEY) === 'mi' ? 'mi' : 'km';
  } catch {
    return 'km';
  }
}

export function writeUnitPreference(unit: DistanceUnit): void {
  try {
    localStorage.setItem(UNIT_KEY, unit);
  } catch {
    // private mode / blocked storage: the choice lasts this page only
  }
}
