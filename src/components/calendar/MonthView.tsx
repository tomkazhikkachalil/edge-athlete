'use client';

import { isSameDay, isSameMonth } from 'date-fns';
import { monthMatrix, eventOverlapsDay } from '@/lib/calendar/grid';
import { categoryColor } from '@/lib/calendar/categories';
import { EventChip } from './EventChip';
import type { EventListItem } from './types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;

// Month grid: ≥sm shows up to 3 chips + "+N more"; on phones the cells show
// category dots. Tapping a day drills down — Week at ≥sm, Day on phones
// (the caller decides; a phone week is a sideways-scrolling 966px grid).
// "+N more" always goes straight to Day: it means "show me everything on
// this day", which Week doesn't answer.
export default function MonthView({
  focusDate,
  events,
  onSelectDay,
  onOpenDay,
  onSelectEvent,
}: {
  focusDate: Date;
  events: EventListItem[];
  onSelectDay: (day: Date) => void;
  /** "+N more" destination; falls back to onSelectDay when absent. */
  onOpenDay?: (day: Date) => void;
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
    <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAY_LABELS.map(label => (
          <div key={label} className="py-2 text-center text-xs font-semibold text-muted">
            {label}
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-border-subtle last:border-b-0">
          {week.map(day => {
            const dayEvents = eventsForDay(day);
            const inMonth = isSameMonth(day, focusDate);
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                className={`relative min-h-16 sm:min-h-24 border-r border-border-subtle last:border-r-0 p-1 transition-colors sm:hover:bg-brand-soft ${
                  inMonth ? 'bg-surface' : 'bg-surface-muted'
                }`}
              >
                {/* The visible target is a 24px circle, far under the 44px
                    touch minimum, and selecting a day is THE interaction for
                    this view — so an invisible ::after overlay makes the whole
                    cell the hit area at EVERY width. (It used to be phone-only,
                    which left desktop with just the tiny circle and nothing
                    signalling it was clickable.) The overlay is a positioned
                    pseudo-element, so it paints over static siblings; the chip
                    column below carries `relative z-10` to stay above it and
                    keep its own clicks. `cursor-pointer` because Tailwind v4
                    buttons are `cursor: default`. */}
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-label={day.toDateString()}
                  // No unconditional hover:bg-* here: it collided with the
                  // today branch's hover:bg-brand-hover (brand-soft won the
                  // cascade), turning today's white number invisible on a
                  // near-white wash. The cell owns the hover tint now.
                  className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full text-xs sm:text-sm mb-0.5 cursor-pointer after:absolute after:inset-0 after:content-[''] ${
                    isToday
                      ? 'bg-brand text-white font-bold hover:bg-brand-hover'
                      : inMonth
                        ? 'text-primary'
                        : 'text-faint'
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
                          ? `border ${categoryColor(e.category).border} bg-surface`
                          : categoryColor(e.category).dot
                      }`}
                    />
                  ))}
                </div>

                {/* ≥sm: chips. `relative z-10` lifts them above the day
                    button's full-cell ::after overlay so they stay clickable. */}
                <div className="relative z-10 hidden sm:flex flex-col gap-0.5">
                  {dayEvents.slice(0, MAX_CHIPS).map(e => (
                    <EventChip key={e.id} event={e} onClick={() => onSelectEvent(e.id)} />
                  ))}
                  {dayEvents.length > MAX_CHIPS && (
                    <button
                      type="button"
                      onClick={() => (onOpenDay ?? onSelectDay)(day)}
                      className="text-left text-xs text-muted hover:text-brand-fg px-1.5"
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
