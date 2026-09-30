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

/** The type's own speed reading: a pace per km/mi, a pace per 100 m (swim), or a speed. */
export function formatPace(distanceM: number | null, seconds: number | null, type: ActivityType, unit: DistanceUnit): { label: string; value: string } {
  const style = ACTIVITY_TYPE_DEFS[type].paceStyle;
  const label = style === 'speed' ? 'Avg speed' : 'Avg pace';
  if (!distanceM || !seconds || distanceM <= 0 || seconds <= 0) return { label, value: '—' };
  if (style === 'swim_pace') return { label, value: `${formatDuration((seconds / distanceM) * 100)} /100m` };
  if (style === 'pace') return { label, value: `${formatDuration((seconds / distanceM) * UNIT_METRES[unit])} /${unit}` };
  const perHour = (distanceM / UNIT_METRES[unit]) / (seconds / 3600);
  return { label, value: `${perHour.toFixed(1)} ${unit === 'km' ? 'km/h' : 'mph'}` };
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
