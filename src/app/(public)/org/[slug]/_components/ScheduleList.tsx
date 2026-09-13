import type { OrgEvent } from '@/lib/calendar/org-events-server';
import { formatEventWhen } from '@/lib/org-sites/format';
import { contestHref } from '@/lib/org-sites/player-links';

// The home schedule: title (a contest's links to its place — Contest Place
// E3), location, when. Program 3, D1: `variant` list (today) or cards;
// `click` detail (today) or none — a title never links.
export default function ScheduleList({
  events,
  basePath,
  variant = 'list',
  click = 'detail',
}: {
  events: OrgEvent[];
  basePath?: string;
  variant?: 'list' | 'cards';
  click?: 'detail' | 'none';
}) {
  const title = (e: OrgEvent) =>
    e.contest_id && click === 'detail' ? (
      <a href={contestHref(e.contest_id, basePath)} className="hover:underline" data-contest-link={e.contest_id}>
        {e.title}
      </a>
    ) : (
      e.title
    );
  if (variant === 'cards') {
    return (
      <ul className="mt-2 grid gap-2 sm:grid-cols-2" data-variant="cards">
        {events.map(e => (
          <li key={e.id} className="rounded-lg border border-border bg-canvas px-3 py-2.5">
            <p className="text-xs text-secondary">{formatEventWhen(e)}</p>
            <p className="mt-0.5 text-sm font-medium text-primary">{title(e)}</p>
            {e.location ? <p className="text-xs text-tertiary truncate">{e.location}</p> : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="mt-2 divide-y divide-border-subtle">
      {events.map(e => (
        <li
          key={e.id}
          className="py-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-primary truncate">{title(e)}</p>
            {e.location ? <p className="text-xs text-tertiary truncate">{e.location}</p> : null}
          </div>
          <p className="text-xs text-secondary shrink-0">{formatEventWhen(e)}</p>
        </li>
      ))}
    </ul>
  );
}
