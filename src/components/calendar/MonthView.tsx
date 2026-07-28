'use client';

import { isSameDay, isSameMonth } from 'date-fns';
import { monthMatrix, eventOverlapsDay } from '@/lib/calendar/grid';
import { categoryColor } from '@/lib/calendar/categories';
import { EventChip } from './EventChip';
import type { EventListItem } from './types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;

// Month grid: ≥sm shows up to 3 chips + "+N more"; on phones the cells show
// category dots. Tapping a day (or "+N more") focuses it in Day view — one
// gesture, no popover machinery.
export default function MonthView({
  focusDate,
  events,
  onSelectDay,
  onSelectEvent,
}: {
  focusDate: Date;
  events: EventListItem[];
  onSelectDay: (day: Date) => void;
  onSelectEvent: (id: string) => void;
}) {
  const weeks = monthMatrix(focusDate);
  const today = new Date();

  const eventsForDay = (day: Date) =>
    events
      .filter(e => eventOverlapsDay(e, day))
      .sort((a, b) => {
        if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
        return Date.parse(a.starts_at) - Date.parse(b.starts_at);
      });

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-200">
        {WEEKDAY_LABELS.map(label => (
          <div key={label} className="py-2 text-center text-xs font-semibold text-gray-500">
            {label}
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
          {week.map(day => {
            const dayEvents = eventsForDay(day);
            const inMonth = isSameMonth(day, focusDate);
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                className={`min-h-16 sm:min-h-24 border-r border-gray-100 last:border-r-0 p-1 ${
                  inMonth ? 'bg-white' : 'bg-gray-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full text-xs sm:text-sm mb-0.5 hover:bg-violet-50 ${
                    isToday
                      ? 'bg-violet-600 text-white font-bold hover:bg-violet-700'
                      : inMonth
                        ? 'text-gray-900'
                        : 'text-gray-400'
                  }`}
                >
                  {day.getDate()}
                </button>

                {/* Phones: dots. */}
                <div className="flex sm:hidden flex-wrap gap-0.5 px-0.5">
                  {dayEvents.slice(0, 4).map(e => (
                    <span
                      key={e.id}
                      className={`w-1.5 h-1.5 rounded-full ${
                        e.my_status === 'invited'
                          ? `border ${categoryColor(e.category).border} bg-white`
                          : categoryColor(e.category).dot
                      }`}
                    />
                  ))}
                </div>

                {/* ≥sm: chips. */}
                <div className="hidden sm:flex flex-col gap-0.5">
                  {dayEvents.slice(0, MAX_CHIPS).map(e => (
                    <EventChip key={e.id} event={e} onClick={() => onSelectEvent(e.id)} />
                  ))}
                  {dayEvents.length > MAX_CHIPS && (
                    <button
                      type="button"
                      onClick={() => onSelectDay(day)}
                      className="text-left text-xs text-gray-500 hover:text-violet-600 px-1.5"
                    >
                      +{dayEvents.length - MAX_CHIPS} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
