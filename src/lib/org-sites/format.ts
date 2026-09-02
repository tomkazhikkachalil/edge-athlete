// ── Public schedule formatting (phase 3 R2) — pure, node-testable ───────────
// The public org site is ONE cached render served to everyone, so event
// times cannot be viewer-local (the calendar grid's viewer-local rule
// belongs to the app, not here). Events render in their OWN zone with the
// zone name attached, in a fixed locale — deterministic across renders.

export interface FormattableEvent {
  starts_at: string;
  /** S4: an all-day event spanning several days reads as a range. */
  ends_at?: string | null;
  all_day: boolean | null;
  timezone: string | null;
}

export function formatEventWhen(e: FormattableEvent): string {
  const date = new Date(e.starts_at);
  if (Number.isNaN(date.getTime())) return '';
  const base: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  const opts: Intl.DateTimeFormatOptions = e.all_day
    ? base
    : { ...base, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  // S4: an all-day event whose exclusive end is more than one day after
  // its start (a golf league's play window) reads as "Tue, Sep 15 – Mon,
  // Sep 21, 2026" — the LAST day, not the exclusive bound.
  if (e.all_day && e.ends_at) {
    const end = new Date(new Date(e.ends_at).getTime() - 86_400_000);
    if (!Number.isNaN(end.getTime()) && end.getTime() - date.getTime() >= 12 * 3_600_000) {
      const zone = e.timezone || 'UTC';
      try {
        const f = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: zone });
        const fy = new Intl.DateTimeFormat('en-US', { ...base, timeZone: zone });
        return `${f.format(date)} – ${fy.format(end)}`;
      } catch {
        /* fall through to the single-date path */
      }
    }
  }
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: e.timezone || 'UTC' }).format(date);
  } catch {
    // An unknown zone string degrades to UTC — never a crash on a public page.
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(date);
  }
}
