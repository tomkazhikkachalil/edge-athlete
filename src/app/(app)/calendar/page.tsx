'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import CalendarPage from '@/components/calendar/CalendarPage';

// useSearchParams must live under Suspense (house rule) — this tiny reader
// captures the ?event= deep link (notification clicks) and ?new=1 (the
// feed widget's "+ New event" hand-off).
function EventParamReader({
  onEvent,
  onNew,
}: {
  onEvent: (id: string) => void;
  onNew: () => void;
}) {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('event');
  const wantsNew = searchParams.get('new') === '1';
  useEffect(() => {
    if (eventId) onEvent(eventId);
    else if (wantsNew) onNew();
  }, [eventId, wantsNew, onEvent, onNew]);
  return null;
}

export default function CalendarRoute() {
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const [deepLinkEventId, setDeepLinkEventId] = useState<string | null>(null);
  const [autoCreate, setAutoCreate] = useState(false);

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  if (loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <Suspense fallback={null}>
        <EventParamReader onEvent={setDeepLinkEventId} onNew={() => setAutoCreate(true)} />
      </Suspense>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Keyed on the deep link: a notification click that lands here (or
            arrives while already on /calendar) remounts with the modal open. */}
        <CalendarPage
          key={`${deepLinkEventId ?? 'none'}:${autoCreate ? 'new' : ''}`}
          deepLinkEventId={deepLinkEventId}
          autoCreate={autoCreate}
        />
      </main>
    </div>
  );
}
