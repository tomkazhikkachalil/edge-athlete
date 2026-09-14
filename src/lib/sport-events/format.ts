/**
 * Display strings for an event (Events program, the event page) — pure.
 * Dates are the date-only class: a `YYYY-MM-DD` is formatted from its parts,
 * never through Date's local parser (the calendar's timezone lesson).
 */
import type { SportEventJoinMode, SportEventStatus, SportEventVisibility } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Sat, Jun 1, 2030" — or the raw value when it is not a date-only string. */
export function formatDateOnly(value: string | null | undefined, opts: { weekday?: boolean } = {}): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  const base = `${MONTHS[mo - 1]} ${d}, ${y}`;
  return opts.weekday ? `${DAYS[utc.getUTCDay()]}, ${base}` : base;
}

/** A tee time (timestamptz) in the viewer's clock — "8:10 AM". */
export function formatTeeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export const STATUS_LABEL: Readonly<Record<SportEventStatus, string>> = {
  draft: 'Draft',
  open: 'Open',
  live: 'Live',
  completed: 'Final',
  cancelled: 'Cancelled',
};

export const VISIBILITY_LABEL: Readonly<Record<SportEventVisibility, string>> = {
  public: 'Public',
  link: 'Anyone with the link',
  private: 'Private',
};

export function joinLine(joinMode: SportEventJoinMode): string {
  return joinMode === 'request' ? 'Open to requests' : 'Invite only';
}

export function formatLabel(format: string): string {
  return format === 'stroke_net' ? 'Stroke play · Net' : 'Stroke play · Gross';
}

/** "18 holes" · "9 holes from the 10th" */
export function holesLabel(holes: number, startingHole: number): string {
  if (holes === 9 && startingHole === 10) return '9 holes from the 10th';
  return `${holes} holes`;
}

/** "3 playing · 1 waitlisted" — capacity when set: "3 of 8 playing". */
export function fieldLine(counts: { playing: number; waitlisted: number }, capacity: number | null): string {
  const playing = capacity !== null ? `${counts.playing} of ${capacity} playing` : `${counts.playing} playing`;
  return counts.waitlisted > 0 ? `${playing} · ${counts.waitlisted} waitlisted` : playing;
}
