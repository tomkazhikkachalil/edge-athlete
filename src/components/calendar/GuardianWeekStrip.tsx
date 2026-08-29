'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { format } from 'date-fns';
import { FEATURE_FLAGS } from '@/lib/features';
import { weekDays, localDayKey, eventOverlapsDay } from '@/lib/calendar/grid';
import { findConflicts, conflictDayKeys, type ConflictEvent } from '@/lib/calendar/conflicts';
import { venueTimeLabel } from '@/lib/calendar/venue-time';
import type { FamilyEvent, FamilyWeekAthlete } from '@/lib/calendar/use-family-week';

const CalendarSyncModal = dynamic(() => import('./CalendarSyncModal'), { ssr: false });

// ── Family week strip (Wave 2) ───────────────────────────────────────────────
// The console's merged calendar surface: every child's next seven days in one
// place, with schedule conflicts flagged where a parent is double-booked as a
// driver. PRESENTATIONAL since Wave 5 — the hub owns the fetch via
// useFamilyWeek (a 14-day window shared with the roster payoff line; this
// strip still renders only its 7 days). The sync button surfaces the
// EXISTING household ICS feed, which already merges supervised children.

/** Static per-child dot classes — indexed by roster order, cycled. */
const CHILD_DOTS = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-amber-500',
];

export default function GuardianWeekStrip({
  athletes,
  events,
  loaded,
  failed,
  onRetry,
}: {
  athletes: FamilyWeekAthlete[];
  events: FamilyEvent[];
  loaded: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string>(() => localDayKey(new Date()));
  const [syncOpen, setSyncOpen] = useState(false);

  const days = useMemo(() => weekDays(new Date()), []);
  const childIndex = useMemo(
    () => new Map(athletes.map((a, i) => [a.id, i])),
    [athletes]
  );

  const conflicts = useMemo(
    () =>
      findConflicts(
        events.map(
          (e): ConflictEvent => ({
            id: e.id,
            title: e.title,
            starts_at: e.starts_at,
            ends_at: e.ends_at,
            all_day: e.all_day,
            timezone: e.timezone,
            childIds: e.childIds,
          })
        )
      ),
    [events]
  );
  const conflictDays = useMemo(() => conflictDayKeys(conflicts), [conflicts]);
  const conflictedEventIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pair of conflicts) for (const id of pair.ids) ids.add(id);
    return ids;
  }, [conflicts]);

  if (!FEATURE_FLAGS.FEATURE_CALENDAR || athletes.length === 0) return null;

  const selectedDate = (() => {
    const [y, m, d] = selectedDay.split('-').map(Number);
    return new Date(y, m - 1, d);
  })();
  const dayEvents = events
    .filter(e => eventOverlapsDay(e, selectedDate))
    .sort((a, b) => {
      if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
      return Date.parse(a.starts_at) - Date.parse(b.starts_at);
    });
  const selectedHasConflict = conflictDays.has(selectedDay);

  return (
    <section aria-label="This week" className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-tertiary">This week</h2>
        <button
          type="button"
          onClick={() => setSyncOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-brand-fg-strong hover:underline"
        >
          <i className="fas fa-calendar-plus text-[10px]"></i>
          Add to your calendar
        </button>
      </div>

      <div className="bg-surface border border-border rounded-lg p-3">
        {failed ? (
          <p className="text-xs text-faint py-2 text-center">
            Couldn&apos;t load the family calendar.{' '}
            <button
              type="button"
              onClick={onRetry}
              className="text-brand-fg hover:underline"
            >
              Retry
            </button>
          </p>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1">
              {days.map(day => {
                const key = localDayKey(day);
                const isSelected = key === selectedDay;
                const isToday = key === localDayKey(new Date());
                const hasConflict = conflictDays.has(key);
                const dots = events
                  .filter(e => eventOverlapsDay(e, day))
                  .flatMap(e => e.childIds);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDay(key)}
                    className={`flex flex-col items-center py-1.5 rounded-lg min-h-[44px] transition-colors ${
                      isSelected ? 'bg-brand-soft ring-1 ring-violet-400' : 'hover:bg-surface-muted'
                    } ${hasConflict ? 'ring-1 ring-amber-400' : ''}`}
                  >
                    <span className="text-[10px] font-semibold text-faint">{format(day, 'EEEEE')}</span>
                    <span
                      className={`w-6 h-6 flex items-center justify-center rounded-full text-xs ${
                        isToday ? 'bg-brand text-white font-bold' : 'text-primary'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    <span className="flex gap-px h-1.5 items-center">
                      {[...new Set(dots)].slice(0, 4).map(childId => (
                        <span
                          key={childId}
                          className={`w-1 h-1 rounded-full ${
                            CHILD_DOTS[(childIndex.get(childId) ?? 0) % CHILD_DOTS.length]
                          }`}
                        />
                      ))}
                      {hasConflict && (
                        <i className="fas fa-triangle-exclamation text-[8px] text-amber-500"></i>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-2 border-t border-border-subtle pt-2">
              {selectedHasConflict && (
                <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-200 mb-2">
                  <i className="fas fa-triangle-exclamation"></i>
                  Schedule conflict — two commitments overlap this day.
                </div>
              )}
              {!loaded ? (
                <p className="text-xs text-faint py-1 text-center">Loading…</p>
              ) : dayEvents.length === 0 ? (
                <p className="text-xs text-faint py-1 text-center">
                  Nothing on {format(selectedDate, 'EEEE')}.
                </p>
              ) : (
                <ul className="space-y-1">
                  {dayEvents.map(ev => (
                    <li
                      key={ev.id}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 min-h-[44px] rounded-lg text-sm ${
                        conflictedEventIds.has(ev.id)
                          ? 'bg-amber-50 dark:bg-amber-950/30'
                          : ''
                      }`}
                    >
                      <span className="text-xs text-muted w-16 shrink-0">
                        {ev.all_day ? 'All day' : format(new Date(Date.parse(ev.starts_at)), 'h:mm a')}
                        {(() => {
                          const venue = venueTimeLabel(ev);
                          return venue ? (
                            <span className="block text-[10px] text-faint">{venue}</span>
                          ) : null;
                        })()}
                      </span>
                      <span className="text-primary font-medium min-w-0 truncate">
                        {ev.title}
                        {ev.my_status === 'invited' && (
                          <span className="text-brand-fg text-xs ml-1">· needs reply</span>
                        )}
                      </span>
                      <span className="flex items-center gap-1 ml-auto shrink-0">
                        {ev.childIds.map(childId => {
                          const athlete = athletes.find(a => a.id === childId);
                          if (!athlete) return null;
                          return (
                            <Link
                              key={childId}
                              href={`/app/guardian/athlete/${childId}`}
                              className="inline-flex items-center gap-1 text-xs text-secondary hover:text-brand-fg-strong"
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  CHILD_DOTS[(childIndex.get(childId) ?? 0) % CHILD_DOTS.length]
                                }`}
                              />
                              {athlete.name.split(' ')[0]}
                            </Link>
                          );
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <CalendarSyncModal isOpen={syncOpen} onClose={() => setSyncOpen(false)} />
    </section>
  );
}
