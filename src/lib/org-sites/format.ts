// ── Public schedule formatting (phase 3 R2) — pure, node-testable ───────────
// The public org site is ONE cached render served to everyone, so event
// times cannot be viewer-local (the calendar grid's viewer-local rule
// belongs to the app, not here). Events render in their OWN zone with the
// zone name attached, in a fixed locale — deterministic across renders.

export interface FormattableEvent {
  starts_at: string;
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
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: e.timezone || 'UTC' }).format(date);
  } catch {
    // An unknown zone string degrades to UTC — never a crash on a public page.
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(date);
  }
}
