'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import LiveNowStrip from '@/components/LiveNowStrip';

/**
 * /live — every live event from people you follow (and your own), the
 * sports-app "follow live" surface. Today that's golf rounds; tournaments
 * and other sports stream through the same seam later.
 */
export default function LivePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-violet-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-h1 font-bold text-gray-900 flex items-center gap-3">
            <span className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></span>
            Live Now
          </h1>
          <p className="text-gray-600 mt-1">
            Follow along as it happens — live rounds and events from athletes you follow.
          </p>
        </div>

        <LiveNowStrip currentUserId={user.id} variant="grid" showEmptyState hideHeading />
      </main>
    </div>
  );
}
