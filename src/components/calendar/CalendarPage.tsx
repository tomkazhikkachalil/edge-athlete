'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { addDays, addMonths, addWeeks, format, startOfDay } from 'date-fns';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { monthMatrix, weekDays } from '@/lib/calendar/grid';
import { ME, mergeLayeredEvents, filterLayeredEvents, personDotClass, type LayeredEvent } from '@/lib/calendar/layers';
import { EVENT_CATEGORIES } from '@/lib/calendar/events';
import { CATEGORY_LABELS, categoryColor } from '@/lib/calendar/categories';
import type { ActivityPayload } from '@/lib/calendar/activity-overlay';
import MonthView from './MonthView';
import FilterChip from './FilterChip';
import { useHouseholdRoster } from './useHouseholdRoster';
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
  const [events, setEvents] = useState<LayeredEvent[]>([]);
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

  const people = useHouseholdRoster();

  // Inlined cancellable IIFE rather than a useCallback called from an effect:
  // the lint rule flags the CALL SITE of any function containing setState, and
  // the guard also stops a slow response for an old range (rapid month paging)
  // from overwriting a newer one. Handlers refetch by bumping refetchKey.
  // Layered fetch (calendar round): the caller's own range PLUS one request
  // per household child (targetProfileId — the authorized read the hub
  // already uses), merged and tagged by lib/calendar/layers. Own failure is
  // the error path; a child's failure never blanks the calendar
  // (family-week doctrine).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const base = `/api/calendar/events?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`;
      const fetchSet = async (personId: string, url: string) => {
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load your calendar');
        return { personId, events: (data.events ?? []) as EventListItem[] };
      };
      try {
        const [own, ...childResults] = await Promise.allSettled([
          fetchSet(ME, base),
          ...(people ?? []).map(p => fetchSet(p.id, `${base}&targetProfileId=${p.id}`)),
        ]);
        if (cancelled) return;
        if (own.status !== 'fulfilled') throw own.reason;
        const sets = [own.value];
        for (const r of childResults) {
          if (r.status === 'fulfilled') sets.push(r.value);
          else console.error('[CALENDAR] child layer failed:', r.reason);
        }
        setEvents(mergeLayeredEvents(sets));
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
  }, [range, refetchKey, showError, people]);

  const refetch = () => setRefetchKey(k => k + 1);

  // Person/category chip filters — AND across groups, OR within (layers.ts).
  // Persisted per user as a lightweight convenience (localStorage, try/catch
  // everywhere: private mode must not break the calendar).
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(() => new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem(`calendar:filters:v1:${user.id}`);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as { people?: unknown[]; categories?: unknown[] };
        setSelectedPeople(new Set((parsed.people ?? []).filter((x): x is string => typeof x === 'string')));
        setSelectedCategories(new Set((parsed.categories ?? []).filter((x): x is string => typeof x === 'string')));
      } catch {
        // unreadable storage or bad JSON — start with no filters
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const persistFilters = (nextPeople: Set<string>, nextCategories: Set<string>) => {
    if (!user?.id) return;
    try {
      localStorage.setItem(
        `calendar:filters:v1:${user.id}`,
        JSON.stringify({ people: [...nextPeople], categories: [...nextCategories] })
      );
    } catch {
      // storage unavailable — the toggle still works for this visit
    }
  };
  const togglePerson = (id: string) => {
    const next = new Set(selectedPeople);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedPeople(next);
    persistFilters(next, selectedCategories);
  };
  const toggleCategory = (cat: string) => {
    const next = new Set(selectedCategories);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    setSelectedCategories(next);
    persistFilters(selectedPeople, next);
  };
  const clearFilters = () => {
    setSelectedPeople(new Set());
    setSelectedCategories(new Set());
    persistFilters(new Set(), new Set());
  };

  // A persisted person id that left the roster (transfer, parking) must not
  // silently hide the calendar — prune to known ids at filter time.
  const rosterIds = useMemo(() => (people ?? []).map(p => p.id), [people]);
  const visibleEvents = useMemo(() => {
    const known = new Set([ME, ...rosterIds]);
    const effectivePeople = new Set([...selectedPeople].filter(id => known.has(id)));
    const filtered = filterLayeredEvents(events, { people: effectivePeople, categories: selectedCategories });
    // Decorate with pre-computed dot classes (children only, cap 3) so the
    // chips render the person channel without roster plumbing.
    if (rosterIds.length === 0) return filtered;
    return filtered.map(ev => {
      const kids = ev.personIds.filter(id => id !== ME);
      return kids.length > 0
        ? { ...ev, personDots: kids.slice(0, 3).map(id => personDotClass(id, rosterIds)) }
        : ev;
    });
  }, [events, selectedPeople, selectedCategories, rosterIds]);
  const anyFilterActive = selectedPeople.size > 0 || selectedCategories.size > 0;

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

      {/* Person + category chip filters — rendered only for households (a
          solo calendar keeps today's clean toolbar). AND across the two
          groups, OR within one; an empty group filters nothing. */}
      {(people?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip selected={selectedPeople.has(ME)} onClick={() => togglePerson(ME)} dot="bg-brand">
            You
          </FilterChip>
          {(people ?? []).map(p => (
            <FilterChip
              key={p.id}
              selected={selectedPeople.has(p.id)}
              onClick={() => togglePerson(p.id)}
              dot={personDotClass(p.id, rosterIds)}
            >
              {p.name}
            </FilterChip>
          ))}
          <span className="h-5 w-px bg-border-strong mx-1" aria-hidden="true" />
          {EVENT_CATEGORIES.map(cat => (
            <FilterChip
              key={cat}
              size="sm"
              selected={selectedCategories.has(cat)}
              onClick={() => toggleCategory(cat)}
              dot={categoryColor(cat).dot}
            >
              {CATEGORY_LABELS[cat] ?? cat}
            </FilterChip>
          ))}
          {anyFilterActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-[44px] items-center text-sm text-brand-fg hover:underline active:underline px-1"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Active view */}
      {view === 'month' && (
        <MonthView focusDate={focusDate} events={visibleEvents} onSelectDay={openFromMonth} onOpenDay={openDay} onSelectEvent={selectEvent} />
      )}
      {view === 'week' && (
        <TimeGridView days={weekDays(focusDate)} events={visibleEvents} onSelectEvent={selectEvent} onCreateRange={handleCreateRange} onSelectDay={openDay} />
      )}
      {view === 'day' && (
        <TimeGridView days={[focusDate]} events={visibleEvents} onSelectEvent={selectEvent} onCreateRange={handleCreateRange} />
      )}
      {view === 'agenda' && (
        <AgendaView focusDate={focusDate} events={visibleEvents} onSelectEvent={selectEvent} />
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
