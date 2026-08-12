'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { addDays, addMonths, addWeeks, format, startOfDay } from 'date-fns';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { monthMatrix, weekDays } from '@/lib/calendar/grid';
import type { ActivityPayload } from '@/lib/calendar/activity-overlay';
import MonthView from './MonthView';
import TimeGridView from './TimeGridView';
import AgendaView from './AgendaView';
import type { CalendarViewKind, EventDetail, EventListItem } from './types';

const EventFormModal = dynamic(() => import('./EventFormModal'), { ssr: false });
const EventDetailModal = dynamic(() => import('./EventDetailModal'), { ssr: false });
const CalendarSyncModal = dynamic(() => import('./CalendarSyncModal'), { ssr: false });
const PostDetailModal = dynamic(() => import('@/components/PostDetailModal'), { ssr: false });
const ActivityPreviewModal = dynamic(() => import('./ActivityPreviewModal'), { ssr: false });

const VIEWS: { key: CalendarViewKind; label: string; icon: string }[] = [
  { key: 'month', label: 'Month', icon: 'fa-calendar' },
  { key: 'week', label: 'Week', icon: 'fa-calendar-week' },
  { key: 'day', label: 'Day', icon: 'fa-calendar-day' },
  { key: 'agenda', label: 'Agenda', icon: 'fa-list' },
];

export default function CalendarPage({
  deepLinkEventId,
  autoCreate = false,
}: {
  deepLinkEventId: string | null;
  autoCreate?: boolean;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { showError } = useToast();
  const [view, setView] = useState<CalendarViewKind>('month');
  const [focusDate, setFocusDate] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refetchKey, setRefetchKey] = useState(0);
  const [detailEventId, setDetailEventId] = useState<string | null>(deepLinkEventId);
  // ?new=1 hand-off (feed widget) opens the create form immediately.
  const [formOpen, setFormOpen] = useState(autoCreate);
  const [editingEvent, setEditingEvent] = useState<EventDetail | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  // The visible range drives the fetch (month/agenda use the full 42-cell
  // grid so boundary days render their events too).
  const range = useMemo(() => {
    if (view === 'week') {
      const days = weekDays(focusDate);
      return { from: startOfDay(days[0]), to: addDays(startOfDay(days[6]), 1) };
    }
    if (view === 'day') {
      const from = startOfDay(focusDate);
      return { from, to: addDays(from, 1) };
    }
    const weeks = monthMatrix(focusDate);
    return {
      from: startOfDay(weeks[0][0]),
      to: addDays(startOfDay(weeks[5][6]), 1),
    };
  }, [view, focusDate]);

  // Inlined cancellable IIFE rather than a useCallback called from an effect:
  // the lint rule flags the CALL SITE of any function containing setState, and
  // the guard also stops a slow response for an old range (rapid month paging)
  // from overwriting a newer one. Handlers refetch by bumping refetchKey.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/calendar/events?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load your calendar');
        if (!cancelled) setEvents(data.events ?? []);
      } catch (e) {
        if (!cancelled) {
          showError('Calendar unavailable', e instanceof Error ? e.message : 'Please try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, refetchKey, showError]);

  const refetch = () => setRefetchKey(k => k + 1);

  const navigate = (direction: -1 | 1) => {
    setFocusDate(prev => {
      if (view === 'week') return addWeeks(prev, direction);
      if (view === 'day') return addDays(prev, direction);
      return addMonths(prev, direction);
    });
  };

  const rangeLabel =
    view === 'day' ? format(focusDate, 'EEEE, MMMM d, yyyy')
    : view === 'week' ? `${format(weekDays(focusDate)[0], 'MMM d')} – ${format(weekDays(focusDate)[6], 'MMM d, yyyy')}`
    : format(focusDate, 'MMMM yyyy');

  const openDay = (day: Date) => {
    setFocusDate(day);
    setView('day');
  };

  // Month drill-down: Week at ≥sm, straight to Day on phones — a phone week
  // is a 966px sideways-scrolling grid where the tapped day may be
  // off-screen, and below sm the month cell tap is the ONLY way into a day.
  // matchMedia is read in the handler, never during render (purity + no
  // extra state/effect).
  const openFromMonth = (day: Date) => {
    setFocusDate(day);
    const wide =
      typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches;
    setView(wide ? 'week' : 'day');
  };

  const closeDetail = () => {
    setDetailEventId(null);
    // Drop a consumed ?event= deep link from the URL.
    if (deepLinkEventId) router.replace('/calendar');
  };

  // Drag-to-create hand-off: the range object is set ONCE per completed
  // drag (the form modal's seeding compares it by identity) and cleared on
  // close so a later plain "New event" doesn't inherit stale times.
  const [draftRange, setDraftRange] = useState<{ start: Date; end: Date } | null>(null);
  const handleCreateRange = useCallback((start: Date, end: Date) => {
    setDraftRange({ start, end });
    setEditingEvent(null);
    setFormOpen(true);
  }, []);

  // Completed-activity items have no events row (the calendar detail route
  // would 404), so they preview in place instead: the real feed post when the
  // activity was shared, otherwise a summary card. Reviewing history never
  // leaves the calendar.
  const [previewPostId, setPreviewPostId] = useState<string | null>(null);
  const [previewActivity, setPreviewActivity] = useState<
    { payload: ActivityPayload; title: string } | null
  >(null);

  const selectEvent = (id: string) => {
    const item = events.find(e => e.id === id);
    if (item?.kind === 'activity' && item.activity) {
      if (item.activity.post_id) setPreviewPostId(item.activity.post_id);
      else setPreviewActivity({ payload: item.activity, title: item.title });
      return;
    }
    setDetailEventId(id);
  };

  const handleDateJump = (value: string) => {
    const [y, m, d] = value.split('-').map(Number);
    if (y && m && d) setFocusDate(new Date(y, m - 1, d));
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Previous"
            className="w-10 h-10 rounded-lg border border-border-strong text-tertiary hover:border-violet-400 hover:text-brand-fg flex items-center justify-center"
          >
            <i className="fas fa-chevron-left text-sm"></i>
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            aria-label="Next"
            className="w-10 h-10 rounded-lg border border-border-strong text-tertiary hover:border-violet-400 hover:text-brand-fg flex items-center justify-center"
          >
            <i className="fas fa-chevron-right text-sm"></i>
          </button>
          <button
            type="button"
            onClick={() => setFocusDate(new Date())}
            className="px-3 h-10 rounded-lg border border-border-strong text-sm text-secondary hover:border-violet-400 hover:text-brand-fg"
          >
            Today
          </button>
        </div>

        <h1 className="text-base sm:text-xl font-bold text-primary flex-grow min-w-32">
          {rangeLabel}
          {loading && <i className="fas fa-spinner fa-spin text-gray-300 dark:text-stone-600 text-sm ml-2"></i>}
        </h1>

        <input
          type="date"
          aria-label="Jump to date"
          onChange={e => e.target.value && handleDateJump(e.target.value)}
          className="h-10 px-2 border border-border-strong rounded-lg text-sm text-secondary hidden sm:block"
        />

        <div className="flex rounded-lg border border-border-strong overflow-hidden">
          {VIEWS.map(v => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              aria-label={v.label}
              className={`h-10 px-2.5 sm:px-3 text-sm font-medium transition ${
                view === v.key ? 'bg-brand text-white' : 'bg-surface text-tertiary hover:text-brand-fg'
              }`}
            >
              <i className={`fas ${v.icon} sm:hidden`}></i>
              <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setSyncOpen(true)}
          aria-label="Sync to another calendar"
          title="Sync to another calendar"
          className="h-10 px-2.5 rounded-lg border border-border-strong text-tertiary hover:border-violet-400 hover:text-brand-fg text-sm"
        >
          <i className="fas fa-rotate"></i>
        </button>

        <button
          type="button"
          onClick={() => { setEditingEvent(null); setFormOpen(true); }}
          className="h-10 px-3 sm:px-4 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand-hover transition flex items-center gap-1.5"
        >
          <i className="fas fa-plus text-xs"></i>
          <span className="hidden sm:inline">New event</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      {/* Active view */}
      {view === 'month' && (
        <MonthView focusDate={focusDate} events={events} onSelectDay={openFromMonth} onOpenDay={openDay} onSelectEvent={selectEvent} />
      )}
      {view === 'week' && (
        <TimeGridView days={weekDays(focusDate)} events={events} onSelectEvent={selectEvent} onCreateRange={handleCreateRange} onSelectDay={openDay} />
      )}
      {view === 'day' && (
        <TimeGridView days={[focusDate]} events={events} onSelectEvent={selectEvent} onCreateRange={handleCreateRange} />
      )}
      {view === 'agenda' && (
        <AgendaView focusDate={focusDate} events={events} onSelectEvent={selectEvent} />
      )}

      {/* Legend for the pending style */}
      <p className="text-xs text-faint">
        <span className="inline-block w-3 h-3 rounded border border-dashed border-gray-400 bg-surface align-middle mr-1"></span>
        Outlined events are invitations waiting for your response.
      </p>

      <EventFormModal
        isOpen={formOpen}
        onClose={() => {
          setFormOpen(false);
          setDraftRange(null);
          // Drop a consumed ?new=1 so refresh/back doesn't reopen the form.
          if (autoCreate) router.replace('/calendar');
        }}
        onSaved={refetch}
        editing={editingEvent}
        defaultDay={view === 'day' || view === 'week' ? focusDate : undefined}
        defaultRange={draftRange ?? undefined}
      />
      <EventDetailModal
        eventId={detailEventId}
        isOpen={detailEventId !== null}
        onClose={closeDetail}
        onChanged={refetch}
        onEdit={event => {
          setDetailEventId(null);
          setEditingEvent(event);
          setFormOpen(true);
        }}
      />
      <CalendarSyncModal isOpen={syncOpen} onClose={() => setSyncOpen(false)} />

      {/* Completed activities preview in place: the shared feed post, or a
          summary card when the activity was never shared. */}
      <PostDetailModal
        postId={previewPostId}
        isOpen={previewPostId !== null}
        onClose={() => setPreviewPostId(null)}
        currentUserId={user?.id}
      />
      <ActivityPreviewModal
        activity={previewActivity?.payload ?? null}
        title={previewActivity?.title ?? ''}
        isOpen={previewActivity !== null}
        onClose={() => setPreviewActivity(null)}
      />
    </div>
  );
}
