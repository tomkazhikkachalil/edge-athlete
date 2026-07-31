'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { addDays, addMonths, format, isSameMonth, startOfDay } from 'date-fns';
import { monthMatrix, eventOverlapsDay, localDayKey } from '@/lib/calendar/grid';
import { categoryColor } from '@/lib/calendar/categories';
import type { EventListItem } from './types';

const EventDetailModal = dynamic(() => import('./EventDetailModal'), { ssr: false });

// Feed-sidebar calendar: upcoming events + a mini month that expands into a
// per-day quick view. Reading and RSVPing happen right here (the detail
// modal); editing and creating hand off to /calendar where the full
// feature set lives. A sidebar widget must never break the feed —
// errors degrade to a quiet retry link (LiveNowStrip precedent).

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const UPCOMING_COUNT = 4;

function EventRow({ event, onClick }: { event: EventListItem; onClick: () => void }) {
  const color = categoryColor(event.category);
  const pending = event.my_status === 'invited';
  const start = new Date(Date.parse(event.starts_at));
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition hover:bg-violet-50 ${
        pending ? 'opacity-70' : ''
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          pending ? `border border-dashed ${color.border} bg-white` : color.dot
        }`}
      />
      <span className="min-w-0 flex-grow">
        <span className="block text-sm text-gray-900 truncate">
          {event.my_status === 'maybe' && <span className="font-bold mr-0.5">?</span>}
          {event.title}
          {event.series_id && <i className="fas fa-arrows-rotate ml-1 text-[9px] text-gray-400"></i>}
        </span>
        <span className="block text-xs text-gray-500">
          {event.all_day ? format(start, 'EEE, MMM d') : format(start, 'EEE, MMM d · h:mm a')}
          {pending && <span className="text-violet-600 ml-1">· needs reply</span>}
        </span>
      </span>
    </button>
  );
}

export default function FeedCalendarWidget() {
  const router = useRouter();
  const [focusMonth, setFocusMonth] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [failed, setFailed] = useState(false);

  // The "has this event already ended" cutoff, ticked once a minute rather
  // than read during render — Date.now() in render is impure
  // (react-hooks/purity) and made the filter depend on unrelated re-renders.
  // One interval for the whole widget; a minute is well inside the resolution
  // anyone perceives on an upcoming-events list.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [gridOpen, setGridOpen] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [detailEventId, setDetailEventId] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  const weeks = useMemo(() => monthMatrix(focusMonth), [focusMonth]);

  const load = useCallback(async () => {
    try {
      const from = startOfDay(weeks[0][0]).toISOString();
      const to = addDays(startOfDay(weeks[5][6]), 1).toISOString();
      const res = await fetch(
        `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setEvents(data.events ?? []);
      setFailed(false);
    } catch (e) {
      console.error('[FEED CALENDAR] load failed:', e);
      setFailed(true);
    }
  }, [weeks]);

  useEffect(() => {
    load();
  }, [load, refetchKey]);

  const refetch = () => setRefetchKey(k => k + 1);

  // Upcoming: next few events from now (or from the paged month's start).
  const upcoming = useMemo(() => {
    const cutoff = nowMs;
    return [...events]
      .filter(e => Date.parse(e.ends_at) >= cutoff)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .slice(0, UPCOMING_COUNT);
  }, [events, nowMs]);

  const eventsForDay = (day: Date) =>
    events
      .filter(e => eventOverlapsDay(e, day))
      .sort((a, b) => {
        if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
        return Date.parse(a.starts_at) - Date.parse(b.starts_at);
      });

  const expandedDayDate = useMemo(() => {
    if (!expandedDay) return null;
    const [y, m, d] = expandedDay.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [expandedDay]);

  const today = new Date();

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-gray-900">
          <i className="fas fa-calendar-days text-violet-600 mr-2"></i>
          Upcoming Events
        </h3>
        <button
          type="button"
          onClick={() => router.push('/calendar')}
          className="text-xs text-violet-600 hover:underline font-medium"
        >
          Open calendar
        </button>
      </div>

      {failed ? (
        <p className="text-xs text-gray-400 py-3 text-center">
          Couldn&apos;t load your events.{' '}
          <button type="button" onClick={refetch} className="text-violet-600 hover:underline">
            Retry
          </button>
        </p>
      ) : (
        <>
          {/* Upcoming list */}
          {upcoming.length === 0 ? (
            <div className="py-3 text-center">
              <p className="text-sm text-gray-500 mb-1">Nothing coming up.</p>
              <button
                type="button"
                onClick={() => router.push('/calendar?new=1')}
                className="text-xs text-violet-600 hover:underline font-medium"
              >
                + New event
              </button>
            </div>
          ) : (
            <div className="space-y-0.5 mb-2">
              {upcoming.map(e => (
                <EventRow key={e.id} event={e} onClick={() => setDetailEventId(e.id)} />
              ))}
            </div>
          )}

          {/* Mini month — expands on demand for the quick view. */}
          <button
            type="button"
            onClick={() => setGridOpen(o => !o)}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-violet-600 py-1.5 border-t border-gray-100"
          >
            <i className={`fas fa-chevron-${gridOpen ? 'up' : 'down'} text-[10px]`}></i>
            {gridOpen ? 'Hide calendar' : 'Show calendar'}
          </button>

          {gridOpen && (
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1.5">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => { setFocusMonth(m => addMonths(m, -1)); setExpandedDay(null); }}
                  className="w-7 h-7 rounded text-gray-400 hover:text-violet-600 hover:bg-violet-50"
                >
                  <i className="fas fa-chevron-left text-xs"></i>
                </button>
                <p className="text-sm font-semibold text-gray-900">{format(focusMonth, 'MMMM yyyy')}</p>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => { setFocusMonth(m => addMonths(m, 1)); setExpandedDay(null); }}
                  className="w-7 h-7 rounded text-gray-400 hover:text-violet-600 hover:bg-violet-50"
                >
                  <i className="fas fa-chevron-right text-xs"></i>
                </button>
              </div>
              <div className="grid grid-cols-7 mb-0.5">
                {WEEKDAY_INITIALS.map((label, i) => (
                  <div key={i} className="text-center text-[10px] font-semibold text-gray-400 py-0.5">
                    {label}
                  </div>
                ))}
              </div>
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7">
                  {week.map(day => {
                    const key = localDayKey(day);
                    const dayEvents = eventsForDay(day);
                    const inMonth = isSameMonth(day, focusMonth);
                    const isToday = localDayKey(today) === key;
                    const isExpanded = expandedDay === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setExpandedDay(prev => (prev === key ? null : key))}
                        className={`flex flex-col items-center py-1 rounded transition hover:bg-violet-50 ${
                          isExpanded ? 'ring-1 ring-violet-400 bg-violet-50' : ''
                        }`}
                      >
                        <span
                          className={`w-5 h-5 flex items-center justify-center rounded-full text-[11px] ${
                            isToday
                              ? 'bg-violet-600 text-white font-bold'
                              : inMonth
                                ? 'text-gray-800'
                                : 'text-gray-300'
                          }`}
                        >
                          {day.getDate()}
                        </span>
                        <span className="flex gap-px h-1.5 items-center">
                          {dayEvents.slice(0, 3).map(e => (
                            <span
                              key={e.id}
                              className={`w-1 h-1 rounded-full ${
                                e.my_status === 'invited'
                                  ? `border ${categoryColor(e.category).border} bg-white`
                                  : categoryColor(e.category).dot
                              }`}
                            />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* Quick view: the tapped day's events. */}
              {expandedDayDate && (
                <div className="mt-2 border-t border-gray-100 pt-2">
                  <p className="text-xs font-semibold text-gray-500 mb-1 px-2">
                    {format(expandedDayDate, 'EEEE, MMMM d')}
                  </p>
                  {eventsForDay(expandedDayDate).length === 0 ? (
                    <p className="text-xs text-gray-400 px-2 pb-1">Nothing on this day.</p>
                  ) : (
                    <div className="space-y-0.5">
                      {eventsForDay(expandedDayDate).map(e => (
                        <EventRow key={e.id} event={e} onClick={() => setDetailEventId(e.id)} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Quick-view modal: read + RSVP here; Edit hands off to /calendar. */}
      <EventDetailModal
        eventId={detailEventId}
        isOpen={detailEventId !== null}
        onClose={() => setDetailEventId(null)}
        onChanged={refetch}
        onEdit={event => {
          setDetailEventId(null);
          router.push(`/calendar?event=${event.id}`);
        }}
      />
    </div>
  );
}
