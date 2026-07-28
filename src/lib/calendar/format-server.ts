// Server-side event time formatting — used where there is no browser to
// localize (emails). Always formats in the EVENT's time zone.

export function formatEventWhen(
  startsAt: string,
  endsAt: string,
  allDay: boolean,
  timeZone: string
): string {
  const start = new Date(Date.parse(startsAt));
  const end = new Date(Date.parse(endsAt));
  if (allDay) {
    const day = new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'full' });
    // End is exclusive midnight — the last covered day is end - 1ms.
    const lastDay = new Date(end.getTime() - 1);
    const startText = day.format(start);
    const endText = day.format(lastDay);
    return startText === endText ? `${startText} (all day)` : `${startText} – ${endText} (all day)`;
  }
  const full = new Intl.DateTimeFormat('en-US', {
    timeZone, dateStyle: 'full', timeStyle: 'short',
  });
  const timeOnly = new Intl.DateTimeFormat('en-US', { timeZone, timeStyle: 'short' });
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' });
  const sameDay = dayKey.format(start) === dayKey.format(end);
  return sameDay
    ? `${full.format(start)} – ${timeOnly.format(end)}`
    : `${full.format(start)} – ${full.format(end)}`;
}
