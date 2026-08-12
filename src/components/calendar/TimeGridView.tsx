'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { format, isSameDay, startOfDay, endOfDay } from 'date-fns';
import {
  assignLanes,
  eventOverlapsDay,
  minutesIntoDay,
  normalizeDragRange,
  rangeLabel,
  snapMinutes,
  yToMinutes,
  HOUR_PX,
  DAY_MINUTES,
} from '@/lib/calendar/grid';
import { haptic } from '@/lib/haptics';
import { EventChip, EventBlock } from './EventChip';
import type { EventListItem } from './types';

// Shared Week/Day time grid: sticky all-day row, hour gutter, absolute
// event blocks laid out side-by-side by assignLanes. Week on phones scrolls
// horizontally (min-w columns).
//
// Drag-to-create: click-drag (mouse/pen) or long-press-drag (touch) on empty
// column space selects a 30-min-snapped range with a live highlight; release
// hands the range to onCreateRange (CalendarPage opens the prefilled form).
// Mouse arms on ~5px of movement so a plain click stays a no-op; touch arms
// on a 400ms hold (MessageBubble long-press canon: slop cancel before the
// timer, haptic on fire, ghost-click suppression, contextmenu guard) and
// only THEN blocks scrolling — a plain swipe scrolls natively. The selection
// is locked to the origin day column; setPointerCapture keeps the move
// stream flowing across neighbours (TrimTimeline pointer-drag canon).

const LONG_PRESS_MS = 400;
const TOUCH_SLOP_PX = 10;
const MOUSE_SLOP_PX = 5;
const EDGE_ZONE_PX = 40;
const EDGE_MAX_STEP_PX = 14;

interface DragState {
  pointerId: number;
  day: Date;
  dayIndex: number;
  columnEl: HTMLDivElement;
  anchorMin: number;
  started: boolean;
  isTouch: boolean;
  downX: number;
  downY: number;
  detach: () => void;
}

interface Selection {
  dayIndex: number;
  startMin: number;
  endMin: number;
}

export default function TimeGridView({
  days,
  events,
  onSelectEvent,
  onCreateRange,
  onSelectDay,
}: {
  days: Date[];
  events: EventListItem[];
  onSelectEvent: (id: string) => void;
  onCreateRange: (start: Date, end: Date) => void;
  /** Week only: day headers become buttons that drill down to Day view. */
  onSelectDay?: (day: Date) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Open the grid at ~7am so the useful part of the day is visible.
    scrollRef.current?.scrollTo({ top: 7 * HOUR_PX });
  }, [days[0]?.toISOString()]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag-to-create machinery ──────────────────────────────────────────────
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const latestClientYRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const blockerRef = useRef<((ev: TouchEvent) => void) | null>(null);

  const applySelection = useCallback((sel: Selection | null) => {
    selectionRef.current = sel;
    setSelection(sel);
  }, []);

  const cleanup = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (blockerRef.current) {
      scrollRef.current?.removeEventListener('touchmove', blockerRef.current);
      blockerRef.current = null;
    }
    const drag = dragRef.current;
    if (drag) {
      drag.detach();
      try {
        drag.columnEl.releasePointerCapture(drag.pointerId);
      } catch {
        /* already released */
      }
      dragRef.current = null;
    }
    applySelection(null);
  }, [applySelection]);

  const updateSelection = useCallback(
    (clientY: number) => {
      const drag = dragRef.current;
      if (!drag?.started) return;
      // Re-read every time: the column's rect shifts as the scroller scrolls.
      const rect = drag.columnEl.getBoundingClientRect();
      const current = snapMinutes(yToMinutes(clientY - rect.top));
      applySelection({ dayIndex: drag.dayIndex, ...normalizeDragRange(drag.anchorMin, current) });
    },
    [applySelection]
  );

  // Keeps the selection tracking while the pointer parks at a scroller edge.
  // Self-scheduling goes through a ref trampoline (the WorkoutEditorScreen
  // flushRef pattern) — a useCallback can't reference itself.
  const edgeScrollTickRef = useRef<() => void>(() => {});
  const edgeScrollTick = useCallback(() => {
    rafRef.current = null;
    const scroller = scrollRef.current;
    const drag = dragRef.current;
    if (!scroller || !drag?.started) return;
    const rect = scroller.getBoundingClientRect();
    const y = latestClientYRef.current;
    let delta = 0;
    if (y < rect.top + EDGE_ZONE_PX) {
      delta = -Math.min(EDGE_MAX_STEP_PX, (rect.top + EDGE_ZONE_PX - y) / 3);
    } else if (y > rect.bottom - EDGE_ZONE_PX) {
      delta = Math.min(EDGE_MAX_STEP_PX, (y - (rect.bottom - EDGE_ZONE_PX)) / 3);
    }
    if (delta === 0) return;
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.min(
      Math.max(before + delta, 0),
      scroller.scrollHeight - scroller.clientHeight
    );
    if (scroller.scrollTop !== before) updateSelection(y);
    rafRef.current = requestAnimationFrame(() => edgeScrollTickRef.current());
  }, [updateSelection]);
  useEffect(() => {
    edgeScrollTickRef.current = edgeScrollTick;
  }, [edgeScrollTick]);

  const beginDrag = useCallback(
    (drag: DragState) => {
      const rect = drag.columnEl.getBoundingClientRect();
      drag.anchorMin = snapMinutes(yToMinutes(drag.downY - rect.top));
      drag.started = true;
      if (drag.isTouch) {
        haptic();
        // The finger has been still for the long-press window, so no native
        // scroll is in flight — a non-passive preventDefault is honored from
        // here on (React's synthetic onTouchMove can't do this).
        const block = (ev: TouchEvent) => ev.preventDefault();
        blockerRef.current = block;
        scrollRef.current?.addEventListener('touchmove', block, { passive: false });
      }
      applySelection({
        dayIndex: drag.dayIndex,
        ...normalizeDragRange(drag.anchorMin, drag.anchorMin),
      });
    },
    [applySelection]
  );

  const handleColumnPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, day: Date, dayIndex: number) => {
      if (e.button !== 0 || dragRef.current) return;
      // Only empty grid space starts a selection — event blocks are buttons.
      if ((e.target as Element).closest('button')) return;
      const columnEl = e.currentTarget;

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || ev.pointerId !== drag.pointerId) return;
        if (!drag.started) {
          const dx = ev.clientX - drag.downX;
          const dy = ev.clientY - drag.downY;
          if (drag.isTouch) {
            // Movement before the hold completes = scroll intent.
            if (Math.hypot(dx, dy) > TOUCH_SLOP_PX) cleanup();
          } else if (Math.abs(dy) >= MOUSE_SLOP_PX) {
            beginDrag(drag);
            latestClientYRef.current = ev.clientY;
            updateSelection(ev.clientY);
          }
          return;
        }
        latestClientYRef.current = ev.clientY;
        updateSelection(ev.clientY);
        if (rafRef.current === null) rafRef.current = requestAnimationFrame(edgeScrollTick);
      };

      const onUp = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || ev.pointerId !== drag.pointerId) return;
        const sel = selectionRef.current;
        if (drag.started && sel) {
          if (drag.isTouch) {
            // Swallow the ghost click the release synthesizes; expires on its
            // own because not every browser fires one.
            suppressClickRef.current = true;
            setTimeout(() => {
              suppressClickRef.current = false;
            }, 600);
          }
          const d = drag.day;
          onCreateRange(
            new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, sel.startMin),
            // Minute 1440 normalizes to next-day midnight.
            new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, sel.endMin)
          );
        }
        cleanup();
      };

      const onCancel = () => cleanup();
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') cleanup();
      };

      columnEl.addEventListener('pointermove', onMove);
      columnEl.addEventListener('pointerup', onUp);
      columnEl.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKeyDown);

      dragRef.current = {
        pointerId: e.pointerId,
        day,
        dayIndex,
        columnEl,
        anchorMin: 0,
        started: false,
        isTouch: e.pointerType === 'touch',
        downX: e.clientX,
        downY: e.clientY,
        detach: () => {
          columnEl.removeEventListener('pointermove', onMove);
          columnEl.removeEventListener('pointerup', onUp);
          columnEl.removeEventListener('pointercancel', onCancel);
          window.removeEventListener('keydown', onKeyDown);
        },
      };
      columnEl.setPointerCapture(e.pointerId);

      if (e.pointerType === 'touch') {
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          const drag = dragRef.current;
          if (drag && !drag.started) beginDrag(drag);
        }, LONG_PRESS_MS);
      }
    },
    [beginDrag, cleanup, edgeScrollTick, onCreateRange, updateSelection]
  );

  const today = new Date();
  const allDayFor = (day: Date) =>
    events.filter(e => e.all_day && eventOverlapsDay(e, day));
  const timedFor = (day: Date) =>
    events.filter(e => !e.all_day && eventOverlapsDay(e, day));

  return (
    <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <div style={{ minWidth: days.length > 1 ? days.length * 130 + 56 : undefined }}>
          {/* Header: day labels. In Week view each header drills down to
              Day view; in Day view it stays a plain div (no dead button).
              Spans, not <p>s, inside the button — <p> isn't phrasing
              content and breaks the click target. */}
          <div className="flex border-b border-border">
            <div className="w-14 shrink-0" />
            {days.map(day => {
              const label = (
                <>
                  <span className="block text-xs text-muted">{format(day, 'EEE')}</span>
                  <span
                    className={`text-sm font-semibold inline-flex items-center justify-center w-7 h-7 rounded-full ${
                      isSameDay(day, today) ? 'bg-brand text-white' : 'text-primary'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                </>
              );
              const cellClass = 'flex-1 py-2 text-center border-l border-border-subtle';
              return onSelectDay && days.length > 1 ? (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-label={`${format(day, 'EEEE, MMMM d')} — open day view`}
                  // `block`: a button is inline-block by default, which would
                  // collapse the stacked label. ~52px tall clears the 44px rule.
                  className={`${cellClass} block hover:bg-brand-soft active:bg-brand-soft transition-colors ea-no-touch-select`}
                >
                  {label}
                </button>
              ) : (
                <div key={day.toISOString()} className={cellClass}>
                  {label}
                </div>
              );
            })}
          </div>

          {/* All-day row */}
          <div className="flex border-b border-border bg-surface-muted/60">
            <div className="w-14 shrink-0 py-1 pr-1 text-right text-[10px] text-faint">all-day</div>
            {days.map(day => (
              <div key={day.toISOString()} className="flex-1 border-l border-border-subtle p-1 flex flex-col gap-0.5 min-h-7">
                {allDayFor(day).map(e => (
                  <EventChip key={e.id} event={e} onClick={() => onSelectEvent(e.id)} showTime={false} />
                ))}
              </div>
            ))}
          </div>

          {/* Scrollable hour grid */}
          <div
            ref={scrollRef}
            className={`overflow-y-auto ${selection ? 'touch-none select-none' : ''}`}
            style={{ maxHeight: '60dvh' }}
          >
            <div className="flex select-none" style={{ height: 24 * HOUR_PX }}>
              {/* Hour gutter */}
              <div className="w-14 shrink-0 relative">
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute right-1 text-[10px] text-faint -translate-y-1/2"
                    style={{ top: h * HOUR_PX }}
                  >
                    {h === 0 ? '' : format(new Date(2000, 0, 1, h), 'h a')}
                  </div>
                ))}
              </div>
              {/* Day columns */}
              {days.map((day, dayIndex) => {
                const laid = assignLanes(timedFor(day));
                return (
                  <div
                    key={day.toISOString()}
                    className="flex-1 relative border-l border-border-subtle ea-no-touch-select"
                    onPointerDown={e => handleColumnPointerDown(e, day, dayIndex)}
                    onClickCapture={e => {
                      // Swallow the touch-drag ghost click before it reaches
                      // an EventBlock and opens the detail modal.
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                    onContextMenu={e => {
                      // Android's native long-press menu — gesture-scoped, so
                      // desktop right-click stays native.
                      if (
                        dragRef.current ||
                        longPressTimerRef.current ||
                        suppressClickRef.current
                      ) {
                        e.preventDefault();
                      }
                    }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        className="absolute left-0 right-0 border-t border-border-subtle"
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
                    {/* Live drag selection */}
                    {selection?.dayIndex === dayIndex && (
                      <div
                        aria-hidden
                        className="absolute inset-x-0.5 z-20 pointer-events-none rounded-md border-2 border-brand bg-brand-soft/80"
                        style={{
                          top: `${(selection.startMin / DAY_MINUTES) * 100}%`,
                          height: `${((selection.endMin - selection.startMin) / DAY_MINUTES) * 100}%`,
                        }}
                      >
                        <span className="block px-1 pt-0.5 text-[10px] leading-tight font-semibold text-brand-fg-strong whitespace-nowrap overflow-hidden">
                          {rangeLabel(selection.startMin, selection.endMin)}
                        </span>
                      </div>
                    )}
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
