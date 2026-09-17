/**
 * Display strings for an event (Events program, the event page) — pure.
 * Dates are the date-only class: a `YYYY-MM-DD` is formatted from its parts,
 * never through Date's local parser (the calendar's timezone lesson).
 */
import type { MatchConfig, MatchSides, SportEventJoinMode, SportEventStatus, SportEventVisibility } from './types';

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
  return joinMode === 'open' ? 'Open to everyone' : joinMode === 'request' ? 'Open to requests' : 'Invite only';
}

export const MATCH_SIDES_LABEL: Readonly<Record<MatchSides, string>> = { singles: 'Singles', fourball: 'Four-ball', foursomes: 'Foursomes' };

/** "Stroke play · Net" · "Match play · Singles · Gross" · "Match play · Four-ball · Net · Bracket" (a match format with no config reads as singles). */
export function formatLabel(format: string, match?: Pick<MatchConfig, 'sides' | 'bracket'> | null): string {
  const net = format === 'stroke_net' || format === 'match_net' || format === 'stableford_net';
  if (format === 'stableford_gross' || format === 'stableford_net') return net ? 'Stableford · Net' : 'Stableford · Gross';
  if (format === 'match_gross' || format === 'match_net') {
    const sides = match?.sides ?? 'singles';
    return `Match play · ${MATCH_SIDES_LABEL[sides]} · ${net ? 'Net' : 'Gross'}${match?.bracket ? ' · Bracket' : ''}`;
  }
  return net ? 'Stroke play · Net' : 'Stroke play · Gross';
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

/**
 * The header's round line (phase 2). One round: "Sat, Jun 1, 2030 · Eagle
 * Creek". A tournament: "Round 2 of 3 · Sat, Jun 8, 2030 · Eagle Creek ·
 * live" for the round in focus (live → next scheduled → last completed),
 * with " · today" when its date is the viewer's day and " · final" when it
 * was the last, and a second line "Next: Round 3 · Sun, Jun 9, 2030".
 */
export function headerRoundLine(
  rounds: ReadonlyArray<{ sequence: number; scheduled_on: string; course_name: string; status: string; name?: string | null }>,
  todayKey: string | null,
): { primary: string; secondary: string | null } {
  const active = [...rounds].filter(r => r.status !== 'cancelled').sort((a, b) => a.sequence - b.sequence);
  if (active.length === 0) return { primary: '', secondary: null };
  if (active.length === 1) return { primary: `${formatDateOnly(active[0].scheduled_on, { weekday: true })} · ${active[0].course_name}`, secondary: null };
  const focus = active.find(r => r.status === 'live') ?? active.find(r => r.status === 'scheduled') ?? active[active.length - 1];
  const scheduledLeft = active.some(r => r.status === 'scheduled');
  const tail = focus.status === 'live' ? ' · live' : focus.status === 'completed' && !scheduledLeft ? ' · final' : todayKey && focus.scheduled_on === todayKey ? ' · today' : '';
  const next = active.find(r => r.sequence > focus.sequence && r.status === 'scheduled') ?? null;
  return {
    primary: `Round ${focus.sequence} of ${active.length}${focus.name ? ` · ${focus.name}` : ''} · ${formatDateOnly(focus.scheduled_on, { weekday: true })} · ${focus.course_name}${tail}`,
    secondary: next ? `Next: Round ${next.sequence}${next.name ? ` · ${next.name}` : ''} · ${formatDateOnly(next.scheduled_on, { weekday: true })}` : null,
  };
}

export const ROUND_STATUS_LABEL: Readonly<Record<string, string>> = {
  scheduled: 'Scheduled',
  live: 'Live',
  completed: 'Final',
  cancelled: 'Cancelled',
};

/** "3 rounds · Jun 1 – Jun 3, 2030" for the overview and the metadata; one round: its date. */
export function roundsSummary(rounds: ReadonlyArray<{ sequence: number; scheduled_on: string; status: string }>): string {
  const active = [...rounds].filter(r => r.status !== 'cancelled').sort((a, b) => a.sequence - b.sequence);
  if (active.length === 0) return '';
  if (active.length === 1) return formatDateOnly(active[0].scheduled_on, { weekday: true });
  const first = active[0].scheduled_on;
  const last = active[active.length - 1].scheduled_on;
  if (first === last) return `${active.length} rounds · ${formatDateOnly(first, { weekday: true })}`;
  const fm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(first);
  const lm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(last);
  const short = fm && lm && fm[1] === lm[1] ? `${MONTHS[Number(fm[2]) - 1]} ${Number(fm[3])} – ${formatDateOnly(last)}` : `${formatDateOnly(first)} – ${formatDateOnly(last)}`;
  return `${active.length} rounds · ${short}`;
}
