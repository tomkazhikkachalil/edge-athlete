'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import SportsSubnav from '@/components/sports/SportsSubnav';
import { useAuth } from '@/lib/auth';

import { EVENTS_FILTER_LABEL, EVENTS_FILTERS, parseEventsFilter } from '@/lib/sports-nav';
import EventCard, { type ListedEvent } from '@/components/sports/EventCard';

/** /sports/events — your events (host or participant), by filter; the New event door. */
export default function EventsListPage() {
  return (
    <Suspense fallback={null}>
      <EventsListInner />
    </Suspense>
  );
}

function EventsListInner() {
  const { user, initialAuthCheckComplete } = useAuth();
  const params = useSearchParams();
  const filter = parseEventsFilter(params.get('filter'));
  const [events, setEvents] = useState<ListedEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!initialAuthCheckComplete || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sport-events?scope=${filter}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) { setFailed(true); return; }
        const data = (await res.json()) as { events: ListedEvent[] };
        setEvents(data.events);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [filter, user, initialAuthCheckComplete]);

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        <SportsSubnav />
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-h1 font-bold text-primary">Events</h1>
            <p className="text-tertiary mt-1">The events you host, play in or follow.</p>
          </div>
          {user && (
            <Link href="/sports/events/new" className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center" data-events-new="">
              <i className="fas fa-plus mr-2" aria-hidden="true"></i>New event
            </Link>
          )}
        </div>

        {initialAuthCheckComplete && !user ? (
          <div className="bg-surface rounded-lg border border-border p-6 text-center">
            <p className="text-secondary mb-4">Log in to see your events, or explore what is on.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/" className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center">Log in</Link>
              <Link href="/sports/explore" className="ea-interactive border border-border-strong text-secondary px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center">Explore</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-4 -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Filter events">
              {EVENTS_FILTERS.map(f => (
                <Link
                  key={f}
                  href={f === 'upcoming' ? '/sports/events' : `/sports/events?filter=${f}`}
                  role="tab"
                  aria-selected={filter === f}
                  data-events-filter={f}
                  className={`shrink-0 min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold border transition-colors inline-flex items-center ${filter === f ? 'bg-brand text-white border-brand' : 'bg-surface text-secondary border-border-strong hover:bg-surface-sunken'}`}
                >
                  {EVENTS_FILTER_LABEL[f]}
                </Link>
              ))}
            </div>
            {failed && <p className="text-sm text-red-700 dark:text-red-300 mb-4">Your events could not be loaded.</p>}
            {events === null && !failed ? (
              <div className="flex justify-center py-12" aria-busy="true"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" /></div>
            ) : events && events.length === 0 ? (
              <div className="bg-surface rounded-lg border border-border p-8 text-center text-muted">
                <i className="fas fa-flag-checkered text-3xl text-gray-300 dark:text-stone-600 mb-3" aria-hidden="true"></i>
                <p>{filter === 'upcoming' ? 'Nothing coming up.' : filter === 'live' ? 'Nothing live right now.' : filter === 'past' ? 'No past events yet.' : 'No events yet.'}</p>
                <p className="text-sm mt-1">Create one and invite your group.</p>
              </div>
            ) : (
              <ul className="grid sm:grid-cols-2 gap-4" data-events-list="">
                {(events ?? []).map(e => <EventCard key={e.id} event={e} />)}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
