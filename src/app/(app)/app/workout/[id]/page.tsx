'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import WorkoutEditorScreen from '@/components/workouts/WorkoutEditorScreen';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';

/**
 * /app/workout/[id] — the workout editor. Active sessions get the live
 * editor (timer + finish flow); completed sessions open in REVIEW mode
 * (edit sets/media after the fact, share if unshared — ?share=1 deep-links
 * straight to the share step). Owner-only; everyone else is sent back to
 * the profile.
 */

// useSearchParams must live under Suspense (house rule) — this tiny reader
// honours ?share=1 so the workout card's Share action (and the Drafts
// round's reopen prompt / Drafts list) can deep-link. It reports BOTH
// answers: the editor mounts only once the param is known, because its
// phase is a useState initialiser — mounting first and learning about
// ?share=1 a tick later used to leave it on the editing step (Oct 2026).
function ShareParamReader({ onRead }: { onRead: (share: boolean) => void }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get('share');
  useEffect(() => {
    onRead(requested === '1');
  }, [requested, onRead]);
  return null;
}

export default function WorkoutSessionPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params?.id;

  const [session, setSession] = useState<ServerWorkoutSession | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  /** null until the ?share= param has been read (see ShareParamReader). */
  const [wantShare, setWantShare] = useState<boolean | null>(null);
  const handleShareParam = useCallback((share: boolean) => setWantShare(share), []);

  useEffect(() => {
    if (!authLoading && !user) router.push('/');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user || !sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/workouts/${sessionId}`, { credentials: 'include', cache: 'no-store' });
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

  const mode = session?.status === 'completed' ? 'review' : 'live';

  return (
    <div className="min-h-screen bg-canvas">
      <Suspense fallback={null}>
        <ShareParamReader onRead={handleShareParam} />
      </Suspense>
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
        ) : wantShare === null ? null : (
          <WorkoutEditorScreen
            mode={mode}
            session={session}
            currentUserId={user.id}
            initialPhase={mode === 'review' && wantShare ? 'share' : 'editing'}
          />
        )}
      </main>
    </div>
  );
}
