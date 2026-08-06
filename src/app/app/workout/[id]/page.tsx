'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import WorkoutEditorScreen from '@/components/workouts/WorkoutEditorScreen';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';

/**
 * /app/workout/[id] — the live workout editor (start, resume, or the
 * finish flow for a just-completed session). Owner-only; everyone else
 * is sent back to the profile.
 */
export default function WorkoutSessionPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params?.id;

  const [session, setSession] = useState<ServerWorkoutSession | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) router.push('/');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user || !sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/workouts/${sessionId}`, { credentials: 'include' });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Workout not found');
        }
        const data = await response.json();
        if (cancelled) return;
        if (data.session.profile_id !== user.id) {
          router.push('/athlete');
          return;
        }
        setSession(data.session);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load workout');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, sessionId, router]);

  if (authLoading || !user || loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main>
        {error || !session ? (
          <div className="max-w-md mx-auto px-4 py-16 text-center">
            <p className="text-tertiary mb-4">{error || 'Workout not found'}</p>
            <button
              onClick={() => router.push('/athlete')}
              className="px-4 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand-hover transition-colors"
            >
              Back to profile
            </button>
          </div>
        ) : (
          <WorkoutEditorScreen mode="live" session={session} currentUserId={user.id} />
        )}
      </main>
    </div>
  );
}
