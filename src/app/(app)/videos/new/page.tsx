'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import NewVideoFlow from '@/components/videos/NewVideoFlow';
import { useAuth } from '@/lib/auth';

// ── /videos/new — link a full game (Videos program, 296) ───────────────────
// Signed-in only (the login form is `/`, never a /login push). The flow
// reads its prefills (?side=&orgId=, ?sportEventId=, ?contestId=,
// ?profileId=) from the URL, so useSearchParams sits under Suspense.

export default function NewVideoPage() {
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete } = useAuth();
  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);
  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 py-6">
        {loading || !initialAuthCheckComplete || !user ? (
          <div className="py-16 text-center text-sm text-muted" role="status" aria-live="polite">Loading…</div>
        ) : (
          <Suspense fallback={<div className="py-16 text-center text-sm text-muted" role="status">Loading…</div>}>
            <NewVideoFlow userId={user.id} />
          </Suspense>
        )}
      </main>
    </div>
  );
}
