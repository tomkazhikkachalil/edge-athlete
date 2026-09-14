'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import EventCreateWizard from '@/components/sport-events/EventCreateWizard';
import { useAuth } from '@/lib/auth';

/** /sports/events/new — the creation wizard (signed in; the calendar page's auth shape). */
export default function NewEventPage() {
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);
  if (loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader />
        <div className="flex items-center justify-center py-16" aria-busy="true"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" /></div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 py-6">
        <EventCreateWizard />
      </main>
    </div>
  );
}
