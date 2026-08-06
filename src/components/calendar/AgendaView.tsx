'use client';

import { format, isSameDay, isSameMonth } from 'date-fns';
import { eventOverlapsDay, monthMatrix } from '@/lib/calendar/grid';
import { EventChip } from './EventChip';
import type { EventListItem } from './types';

// Agenda: the focused month's events as a scrolling day-grouped list —
// the naturally-mobile view.
export default function AgendaView({
  focusDate,
  events,
  onSelectEvent,
}: {
  focusDate: Date;
  events: EventListItem[];
  onSelectEvent: (id: string) => void;
}) {
  const today = new Date();
  const days = monthMatrix(focusDate)
    .flat()
    .filter(day => isSameMonth(day, focusDate));

  const groups = days
    .map(day => ({
      day,
      events: events
        .filter(e => eventOverlapsDay(e, day))
        .sort((a, b) => {
          if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
          return Date.parse(a.starts_at) - Date.parse(b.starts_at);
        }),
    }))
    .filter(g => g.events.length > 0);

  if (groups.length === 0) {
    return (
      <div className="bg-surface rounded-lg shadow-sm border border-border p-8 text-center">
        <i className="fas fa-calendar-day text-gray-300 dark:text-stone-600 text-3xl mb-3 block"></i>
        <p className="text-sm text-muted">
          Nothing scheduled in {format(focusDate, 'MMMM yyyy')}.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg shadow-sm border border-border divide-y divide-border-subtle">
      {groups.map(({ day, events: dayEvents }) => (
        <div key={day.toISOString()} className="flex gap-3 p-3">
          <div className="w-14 shrink-0 text-center">
            <p className="text-xs text-muted">{format(day, 'EEE')}</p>
            <p
              className={`text-lg font-semibold inline-flex items-center justify-center w-8 h-8 rounded-full ${
                isSameDay(day, today) ? 'bg-brand text-white' : 'text-primary'
              }`}
            >
              {day.getDate()}
            </p>
          </div>
          <div className="flex-grow flex flex-col gap-1 min-w-0">
            {dayEvents.map(e => (
              <EventChip key={e.id} event={e} onClick={() => onSelectEvent(e.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
