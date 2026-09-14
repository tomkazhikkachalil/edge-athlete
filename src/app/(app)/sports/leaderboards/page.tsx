'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import SportsSubnav from '@/components/sports/SportsSubnav';
import { useAuth } from '@/lib/auth';
import EventCard, { type ListedEvent } from '@/components/sports/EventCard';

/** /sports/leaderboards — phase 1: the boards of your live and finished events (the events' own leaderboard tab). */
export default function LeaderboardsPage() {
  const { user, initialAuthCheckComplete } = useAuth();
  const [events, setEvents] = useState<ListedEvent[] | null>(null);

  useEffect(() => {
    if (!initialAuthCheckComplete || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const [live, past] = await Promise.all([
          fetch('/api/sport-events?scope=live', { cache: 'no-store' }).then(r => (r.ok ? r.json() : { events: [] })),
          fetch('/api/sport-events?scope=past', { cache: 'no-store' }).then(r => (r.ok ? r.json() : { events: [] })),
        ]);
        if (cancelled) return;
        const all = [...(live.events ?? []), ...(past.events ?? [])] as ListedEvent[];
        setEvents(all.filter(e => e.status === 'live' || e.status === 'completed'));
      } catch {
        if (!cancelled) setEvents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user, initialAuthCheckComplete]);

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        <SportsSubnav />
        <div className="mb-6">
          <h1 className="text-h1 font-bold text-primary">Leaderboards</h1>
          <p className="text-tertiary mt-1">Live boards and final results from your events.</p>
        </div>
        {initialAuthCheckComplete && !user ? (
          <div className="bg-surface rounded-lg border border-border p-6 text-center">
            <p className="text-secondary mb-4">Log in to see the leaderboards of your events.</p>
            <Link href="/" className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center">Log in</Link>
          </div>
        ) : events === null ? (
          <div className="flex justify-center py-12" aria-busy="true"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" /></div>
        ) : events.length === 0 ? (
          <div className="bg-surface rounded-lg border border-border p-8 text-center text-muted" data-leaderboards-empty="">
            <i className="fas fa-trophy text-3xl text-gray-300 dark:text-stone-600 mb-3" aria-hidden="true"></i>
            <p>No leaderboards yet.</p>
            <p className="text-sm mt-1">A board appears here once one of your events goes live.</p>
          </div>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-4" data-leaderboards-list="">
            {events.map(e => <EventCard key={e.id} event={e} href={`/events/${e.id}?tab=leaderboard`} />)}
          </ul>
        )}
      </main>
    </div>
  );
}
