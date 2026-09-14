'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import EventPlace from '@/components/sport-events/EventPlace';
import { eventApi } from '@/lib/sport-events/client';
import type { SportEventViewPayload } from '@/lib/sport-events/view';

/**
 * The gated branch of /events/[id] (the ContestGate shape): the server
 * renders a public event itself; a link, a private or an unknown event
 * lands here, fetches WITH the session (the API's gate decides) and
 * renders the same place for a member, or a real not-available screen
 * with a way back. initialAuthCheckComplete before !user.
 */
export default function EventGate({ eventId, token }: { eventId: string; token: string | null }) {
  const { user, loading: authLoading, initialAuthCheckComplete } = useAuth();
  const [view, setView] = useState<SportEventViewPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    if (!initialAuthCheckComplete || authLoading) return;
    let cancelled = false;
    (async () => {
      const res = await eventApi(eventId, token).view();
      if (cancelled) return;
      if (!res.ok || !res.data) { setState('unavailable'); return; }
      setView(res.data);
      setState('ready');
    })();
    return () => { cancelled = true; };
  }, [eventId, token, initialAuthCheckComplete, authLoading, user?.id]);

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 py-6">{body}</main>
    </div>
  );

  if (state === 'loading') {
    return shell(<div className="flex items-center justify-center py-16" aria-busy="true"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" /></div>);
  }
  if (state === 'unavailable' || !view) {
    return shell(
      <div className="bg-surface rounded-lg border border-border p-6 text-center" data-event-unavailable="">
        <h1 className="text-h3 font-bold text-primary mb-2">This event isn&apos;t available</h1>
        <p className="text-tertiary mb-4">
          {user ? "It may have been cancelled or removed, or you're not on its list yet — ask the host for an invite." : 'Log in to see an event you were invited to.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {user ? (
            <Link href="/feed" className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center">Back to feed</Link>
          ) : (
            <Link href="/" className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center">Log in</Link>
          )}
        </div>
      </div>
    );
  }
  return shell(
    <Suspense fallback={null}>
      <EventPlace eventId={eventId} initialView={view} token={token} />
    </Suspense>
  );
}
