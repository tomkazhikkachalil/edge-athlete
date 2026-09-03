'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { addDays, addMonths, format, isSameMonth, startOfDay } from 'date-fns';
import { monthMatrix, eventOverlapsDay, localDayKey } from '@/lib/calendar/grid';
import { categoryColor, CATEGORY_LABELS } from '@/lib/calendar/categories';
import { EVENT_CATEGORIES } from '@/lib/calendar/events';
import { ME, mergeLayeredEvents, filterLayeredEvents, personDotClass, type LayeredEvent } from '@/lib/calendar/layers';
import { venueTimeLabel } from '@/lib/calendar/venue-time';
import { useAuth } from '@/lib/auth';
import type { ActivityPayload } from '@/lib/calendar/activity-overlay';
import type { EventListItem } from './types';
import FilterChip from './FilterChip';
import { useHouseholdRoster } from './useHouseholdRoster';

const EventDetailModal = dynamic(() => import('./EventDetailModal'), { ssr: false });
const PostDetailModal = dynamic(() => import('@/components/PostDetailModal'), { ssr: false });
const ActivityPreviewModal = dynamic(() => import('./ActivityPreviewModal'), { ssr: false });

// Feed-sidebar calendar: two views behind a segmented control — Upcoming (the
// next few events) and Month (a mini grid; tap a day for its events) — with a
// filter row that shows only what applies to THIS viewer: person chips for a
// household, category chips for the categories they actually have, and a
// "Needs reply" chip while an invite is pending. Reading and RSVPing happen
// right here (the detail modal); editing and creating hand off to /calendar
// where the full feature set lives. A sidebar widget must never break the
// feed — errors degrade to a quiet retry link (LiveNowStrip precedent).
//
// Data is layered exactly like /calendar (own range + one request per
// household child, merged by lib/calendar/layers): a solo viewer makes one
// request and sees no person chips at all.

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const UPCOMING_COUNT = 5;
const UPCOMING_DAYS = 42;

type SidebarView = 'upcoming' | 'month';

interface SidebarPrefs {
  view?: unknown;
  people?: unknown[];
  categories?: unknown[];
  needsReply?: unknown;
}

const prefsKey = (userId: string) => `calendar:sidebar:v1:${userId}`;

function EventRow({ event, onClick }: { event: EventListItem; onClick: () => void }) {
  const color = categoryColor(event.category);
  const pending = event.my_status === 'invited';
  const start = new Date(Date.parse(event.starts_at));
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition hover:bg-brand-soft ${
        pending ? 'opacity-70' : ''
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          pending ? `border border-dashed ${color.border} bg-surface` : color.dot
        }`}
      />
      <span className="min-w-0 flex-grow">
        <span className="block text-sm text-primary truncate">
          {event.my_status === 'maybe' && <span className="font-bold mr-0.5">?</span>}
          {event.title}
          {event.series_id && <i className="fas fa-arrows-rotate ml-1 text-[9px] text-faint"></i>}
        </span>
        <span className="block text-xs text-muted">
          {event.all_day ? format(start, 'EEE, MMM d') : format(start, 'EEE, MMM d · h:mm a')}
          {(() => {
            const venue = venueTimeLabel(event);
            return venue ? <span className="text-faint"> · {venue}</span> : null;
          })()}
          {pending && <span className="text-brand-fg ml-1">· needs reply</span>}
        </span>
      </span>
    </button>
  );
}

export default function FeedCalendarWidget() {
  const router = useRouter();
  const { user } = useAuth();
  const people = useHouseholdRoster();

  const [view, setView] = useState<SidebarView>('upcoming');
  const [focusMonth, setFocusMonth] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<LayeredEvent[]>([]);
  const [failed, setFailed] = useState(false);
  const [refetchKey, setRefetchKey] = useState(0);

  // The "has this event already ended" cutoff, ticked once a minute rather
  // than read during render — Date.now() in render is impure
  // (react-hooks/purity) and made the filter depend on unrelated re-renders.
  // One interval for the whole widget; a minute is well inside the resolution
  // anyone perceives on an upcoming-events list. The day key derived from it
  // is what the Upcoming range and the "today" ring key off.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const todayKey = localDayKey(new Date(nowMs));

  // Filters — same semantics as /calendar (AND across groups, OR within),
  // plus a needs-reply toggle. Persisted per user with the chosen view as a
  // lightweight convenience (localStorage, try/catch everywhere).
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(() => new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set());
  const [needsReply, setNeedsReply] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem(prefsKey(user.id));
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as SidebarPrefs;
        if (parsed.view === 'month' || parsed.view === 'upcoming') setView(parsed.view);
        setSelectedPeople(new Set((parsed.people ?? []).filter((x): x is string => typeof x === 'string')));
        setSelectedCategories(new Set((parsed.categories ?? []).filter((x): x is string => typeof x === 'string')));
        setNeedsReply(parsed.needsReply === true);
      } catch {
        // unreadable storage or bad JSON — defaults
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const persist = (next: { view?: SidebarView; people?: Set<string>; categories?: Set<string>; needsReply?: boolean }) => {
    if (!user?.id) return;
    try {
      localStorage.setItem(
        prefsKey(user.id),
        JSON.stringify({
          view: next.view ?? view,
          people: [...(next.people ?? selectedPeople)],
          categories: [...(next.categories ?? selectedCategories)],
          needsReply: next.needsReply ?? needsReply,
        })
      );
    } catch {
      // storage unavailable — the choice still holds for this visit
    }
  };
  const switchView = (next: SidebarView) => {
    setView(next);
    persist({ view: next });
  };
  const togglePerson = (id: string) => {
    const next = new Set(selectedPeople);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedPeople(next);
    persist({ people: next });
  };
  const toggleCategory = (cat: string) => {
    const next = new Set(selectedCategories);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    setSelectedCategories(next);
    persist({ categories: next });
  };
  const toggleNeedsReply = () => {
    setNeedsReply(v => !v);
    persist({ needsReply: !needsReply });
  };
  const clearFilters = () => {
    setSelectedPeople(new Set());
    setSelectedCategories(new Set());
    setNeedsReply(false);
    persist({ people: new Set(), categories: new Set(), needsReply: false });
  };

  const weeks = useMemo(() => monthMatrix(focusMonth), [focusMonth]);

  // Range per view: Upcoming looks ahead from today; Month covers the grid.
  const range = useMemo(() => {
    if (view === 'month') {
      return {
        from: startOfDay(weeks[0][0]).toISOString(),
        to: addDays(startOfDay(weeks[5][6]), 1).toISOString(),
      };
    }
    const [y, m, d] = todayKey.split('-').map(Number);
    const today = new Date(y, m - 1, d);
    return { from: today.toISOString(), to: addDays(today, UPCOMING_DAYS).toISOString() };
  }, [view, weeks, todayKey]);

  // Inlined cancellable IIFE — see CalendarPage for the rationale. Own
  // failure is the Retry path; a child's failure only logs (family-week
  // doctrine: a child's fetch never blanks the widget). Retry bumps refetchKey.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = `/api/calendar/events?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
      const fetchSet = async (personId: string, url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
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
          else console.error('[FEED CALENDAR] child layer failed:', r.reason);
        }
        setEvents(mergeLayeredEvents(sets));
        setFailed(false);
      } catch (e) {
        if (cancelled) return;
        console.error('[FEED CALENDAR] load failed:', e);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, refetchKey, people]);

  const refetch = () => setRefetchKey(k => k + 1);

  // Which chips this viewer gets: people only for a household; categories only
  // the ones present in the loaded events (and only when there is a choice);
  // needs-reply only while an invite is pending. A persisted selection that
  // no longer has a chip is pruned at filter time so nothing hides silently.
  const rosterIds = useMemo(() => (people ?? []).map(p => p.id), [people]);
  const presentCategories = useMemo(
    () => EVENT_CATEGORIES.filter(cat => events.some(e => e.category === cat)),
    [events]
  );
  const hasInvites = useMemo(() => events.some(e => e.my_status === 'invited'), [events]);
  const showPeople = rosterIds.length > 0;
  const showCategories = presentCategories.length > 1;

  const visibleEvents = useMemo(() => {
    const knownPeople = new Set([ME, ...rosterIds]);
    const effectivePeople = new Set(showPeople ? [...selectedPeople].filter(id => knownPeople.has(id)) : []);
    const knownCats = new Set<string>(presentCategories);
    const effectiveCategories = new Set(showCategories ? [...selectedCategories].filter(c => knownCats.has(c)) : []);
    const filtered = filterLayeredEvents(events, { people: effectivePeople, categories: effectiveCategories });
    return needsReply && hasInvites ? filtered.filter(e => e.my_status === 'invited') : filtered;
  }, [events, rosterIds, showPeople, selectedPeople, presentCategories, showCategories, selectedCategories, needsReply, hasInvites]);

  const anyFilterActive =
    (showPeople && selectedPeople.size > 0) ||
    (showCategories && selectedCategories.size > 0) ||
    (hasInvites && needsReply);
  const showFilterRow = showPeople || showCategories || hasInvites;

  // Completed-activity overlay items have no events row — preview in place
  // (the shared feed post, else a summary card) rather than opening the
  // guaranteed-404 event detail modal. Reading happens in the widget; only
  // mutations hand off to /calendar.
  const [detailEventId, setDetailEventId] = useState<string | null>(null);
  const [previewPostId, setPreviewPostId] = useState<string | null>(null);
  const [previewActivity, setPreviewActivity] = useState<
    { payload: ActivityPayload; title: string } | null
  >(null);

  const selectEvent = (event: EventListItem) => {
    if (event.kind === 'activity' && event.activity) {
      if (event.activity.post_id) setPreviewPostId(event.activity.post_id);
      else setPreviewActivity({ payload: event.activity, title: event.title });
      return;
    }
    setDetailEventId(event.id);
  };

  // Upcoming: the next few events from now.
  const upcoming = useMemo(() => {
    const cutoff = nowMs;
    return [...visibleEvents]
      .filter(e => Date.parse(e.ends_at) >= cutoff)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .slice(0, UPCOMING_COUNT);
  }, [visibleEvents, nowMs]);

  const eventsForDay = (day: Date) =>
    visibleEvents
      .filter(e => eventOverlapsDay(e, day))
      .sort((a, b) => {
        if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
        return Date.parse(a.starts_at) - Date.parse(b.starts_at);
      });

  // Month view: the tapped day's quick list; today by default while the
  // current month is in view, nothing when the viewer pages away.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const effectiveDay = selectedDay ?? (isSameMonth(focusMonth, new Date(nowMs)) ? todayKey : null);
  const selectedDayDate = useMemo(() => {
    if (!effectiveDay) return null;
    const [y, m, d] = effectiveDay.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [effectiveDay]);
  const pageMonth = (direction: -1 | 1) => {
    setFocusMonth(m => addMonths(m, direction));
    setSelectedDay(null);
  };

  return (
    <div className="bg-surface rounded-lg shadow-sm border border-border p-4" data-testid="feed-calendar">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-primary">
          <i className="fas fa-calendar-days text-brand-fg mr-2"></i>
          Calendar
        </h3>
        <button
          type="button"
          onClick={() => router.push('/calendar')}
          className="inline-flex min-h-[44px] items-center text-xs text-brand-fg hover:underline active:underline font-medium"
        >
          Open calendar
        </button>
      </div>

      {/* Segmented view switch */}
      <div
        className="flex rounded-lg bg-surface-sunken p-0.5 mb-3"
        role="tablist"
        aria-label="Sidebar calendar view"
      >
        {([['upcoming', 'Upcoming'], ['month', 'Month']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => switchView(key)}
            className={`flex-1 min-h-[40px] rounded-md text-sm font-medium transition-colors ${
              view === key ? 'bg-surface text-primary shadow-sm' : 'text-tertiary hover:text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {failed ? (
        <p className="text-xs text-faint py-3 text-center">
          Couldn&apos;t load your events.{' '}
          <button type="button" onClick={refetch} className="text-brand-fg hover:underline">
            Retry
          </button>
        </p>
      ) : (
        <>
          {/* Filters — only the chips that apply to this viewer. */}
          {showFilterRow && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3" data-testid="feed-calendar-filters">
              {showPeople && (
                <>
                  <FilterChip size="sm" selected={selectedPeople.has(ME)} onClick={() => togglePerson(ME)} dot="bg-brand">
                    You
                  </FilterChip>
                  {(people ?? []).map(p => (
                    <FilterChip
                      key={p.id}
                      size="sm"
                      selected={selectedPeople.has(p.id)}
                      onClick={() => togglePerson(p.id)}
                      dot={personDotClass(p.id, rosterIds)}
                    >
                      {p.name}
                    </FilterChip>
                  ))}
                </>
              )}
              {showCategories &&
                presentCategories.map(cat => (
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
              {hasInvites && (
                <FilterChip size="sm" selected={needsReply} onClick={toggleNeedsReply}>
                  <i className="fas fa-reply text-[10px]" aria-hidden="true"></i>
                  Needs reply
                </FilterChip>
              )}
              {anyFilterActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex min-h-[44px] items-center text-xs text-brand-fg hover:underline active:underline px-1"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {view === 'upcoming' ? (
            upcoming.length === 0 ? (
              <div className="py-3 text-center">
                <p className="text-sm text-muted mb-1">
                  {anyFilterActive ? 'Nothing matches these filters.' : 'Nothing coming up.'}
                </p>
                {anyFilterActive ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex min-h-[44px] items-center text-xs text-brand-fg hover:underline active:underline font-medium"
                  >
                    Clear filters
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => router.push('/calendar?new=1')}
                    className="inline-flex min-h-[44px] items-center text-xs text-brand-fg hover:underline active:underline font-medium"
                  >
                    + New event
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-0.5" data-testid="feed-calendar-upcoming">
                {upcoming.map(e => (
                  <EventRow key={e.id} event={e} onClick={() => selectEvent(e)} />
                ))}
              </div>
            )
          ) : (
            <div data-testid="feed-calendar-month">
              <div className="flex items-center justify-between mb-1.5">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => pageMonth(-1)}
                  className="w-10 h-10 rounded text-faint hover:text-brand-fg hover:bg-brand-soft"
                >
                  <i className="fas fa-chevron-left text-xs"></i>
                </button>
                <p className="text-sm font-semibold text-primary">{format(focusMonth, 'MMMM yyyy')}</p>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => pageMonth(1)}
                  className="w-10 h-10 rounded text-faint hover:text-brand-fg hover:bg-brand-soft"
                >
                  <i className="fas fa-chevron-right text-xs"></i>
                </button>
              </div>
              <div className="grid grid-cols-7 mb-0.5">
                {WEEKDAY_INITIALS.map((label, i) => (
                  <div key={i} className="text-center text-[10px] font-semibold text-faint py-0.5">
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
                    const isToday = todayKey === key;
                    const isSelected = effectiveDay === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedDay(prev => (prev === key ? null : key))}
                        className={`flex flex-col items-center py-1 rounded transition hover:bg-brand-soft ${
                          isSelected ? 'ring-1 ring-violet-400 bg-brand-soft' : ''
                        }`}
                      >
                        <span
                          className={`w-5 h-5 flex items-center justify-center rounded-full text-[11px] ${
                            isToday
                              ? 'bg-brand text-white font-bold'
                              : inMonth
                                ? 'text-primary'
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
                                  ? `border ${categoryColor(e.category).border} bg-surface`
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

              {/* Quick view: the selected day's events. */}
              {selectedDayDate && (
                <div className="mt-2 border-t border-border-subtle pt-2">
                  <p className="text-xs font-semibold text-muted mb-1 px-2">
                    {format(selectedDayDate, 'EEEE, MMMM d')}
                  </p>
                  {eventsForDay(selectedDayDate).length === 0 ? (
                    <p className="text-xs text-faint px-2 pb-1">Nothing on this day.</p>
                  ) : (
                    <div className="space-y-0.5">
                      {eventsForDay(selectedDayDate).map(e => (
                        <EventRow key={e.id} event={e} onClick={() => selectEvent(e)} />
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

      {/* Completed activities: the shared feed post, or a summary card. */}
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
