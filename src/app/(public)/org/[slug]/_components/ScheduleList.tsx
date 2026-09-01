import type { OrgEvent } from '@/lib/calendar/org-events-server';
import { formatEventWhen } from '@/lib/org-sites/format';

// Upcoming-events rows (home preview and /schedule both render this;
// the page decides how many events to pass). Times render in each
// event's own zone — one cached render serves every viewer.
export default function ScheduleList({ events }: { events: OrgEvent[] }) {
  return (
    <ul className="mt-2 divide-y divide-border-subtle">
      {events.map(e => (
        <li
          key={e.id}
          className="py-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-primary truncate">{e.title}</p>
            {e.location ? <p className="text-xs text-tertiary truncate">{e.location}</p> : null}
          </div>
          <p className="text-xs text-secondary shrink-0">{formatEventWhen(e)}</p>
        </li>
      ))}
    </ul>
  );
}
