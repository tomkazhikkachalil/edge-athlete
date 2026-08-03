'use client';

import { useEffect, useRef } from 'react';
import { format, isSameDay, startOfDay, endOfDay } from 'date-fns';
import { assignLanes, eventOverlapsDay, minutesIntoDay } from '@/lib/calendar/grid';
import { EventChip, EventBlock } from './EventChip';
import type { EventListItem } from './types';

const HOUR_PX = 48; // 24h × 48px = 1152px column
const DAY_MINUTES = 1440;

// Shared Week/Day time grid: sticky all-day row, hour gutter, absolute
// event blocks laid out side-by-side by assignLanes. Week on phones scrolls
// horizontally (min-w columns).
export default function TimeGridView({
  days,
  events,
  onSelectEvent,
}: {
  days: Date[];
  events: EventListItem[];
  onSelectEvent: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Open the grid at ~7am so the useful part of the day is visible.
    scrollRef.current?.scrollTo({ top: 7 * HOUR_PX });
  }, [days[0]?.toISOString()]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date();
  const allDayFor = (day: Date) =>
    events.filter(e => e.all_day && eventOverlapsDay(e, day));
  const timedFor = (day: Date) =>
    events.filter(e => !e.all_day && eventOverlapsDay(e, day));

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <div style={{ minWidth: days.length > 1 ? days.length * 130 + 56 : undefined }}>
          {/* Header: day labels */}
          <div className="flex border-b border-gray-200">
            <div className="w-14 shrink-0" />
            {days.map(day => (
              <div key={day.toISOString()} className="flex-1 py-2 text-center border-l border-gray-100">
                <p className="text-xs text-gray-500">{format(day, 'EEE')}</p>
                <p
                  className={`text-sm font-semibold inline-flex items-center justify-center w-7 h-7 rounded-full ${
                    isSameDay(day, today) ? 'bg-violet-600 text-white' : 'text-gray-900'
                  }`}
                >
                  {day.getDate()}
                </p>
              </div>
            ))}
          </div>

          {/* All-day row */}
          <div className="flex border-b border-gray-200 bg-gray-50/60">
            <div className="w-14 shrink-0 py-1 pr-1 text-right text-[10px] text-gray-400">all-day</div>
            {days.map(day => (
              <div key={day.toISOString()} className="flex-1 border-l border-gray-100 p-1 flex flex-col gap-0.5 min-h-7">
                {allDayFor(day).map(e => (
                  <EventChip key={e.id} event={e} onClick={() => onSelectEvent(e.id)} showTime={false} />
                ))}
              </div>
            ))}
          </div>

          {/* Scrollable hour grid */}
          <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: '60dvh' }}>
            <div className="flex" style={{ height: 24 * HOUR_PX }}>
              {/* Hour gutter */}
              <div className="w-14 shrink-0 relative">
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute right-1 text-[10px] text-gray-400 -translate-y-1/2"
                    style={{ top: h * HOUR_PX }}
                  >
                    {h === 0 ? '' : format(new Date(2000, 0, 1, h), 'h a')}
                  </div>
                ))}
              </div>
              {/* Day columns */}
              {days.map(day => {
                const laid = assignLanes(timedFor(day));
                return (
                  <div key={day.toISOString()} className="flex-1 relative border-l border-gray-100">
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        className="absolute left-0 right-0 border-t border-gray-100"
                        style={{ top: h * HOUR_PX }}
                      />
                    ))}
                    {laid.map(({ event, laneIndex, laneCount }) => {
                      // Clip to this day's bounds for cross-midnight events.
                      const clippedStart = Math.max(Date.parse(event.starts_at), startOfDay(day).getTime());
                      const clippedEnd = Math.min(Date.parse(event.ends_at), endOfDay(day).getTime() + 1);
                      const startMin = minutesIntoDay(new Date(clippedStart));
                      const durMin = Math.max((clippedEnd - clippedStart) / 60_000, 20);
                      const width = 100 / laneCount;
                      return (
                        <EventBlock
                          key={event.id}
                          event={event}
                          topPct={(startMin / DAY_MINUTES) * 100}
                          heightPct={(durMin / DAY_MINUTES) * 100}
                          leftPct={laneIndex * width}
                          widthPct={width - 1}
                          onClick={() => onSelectEvent(event.id)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
