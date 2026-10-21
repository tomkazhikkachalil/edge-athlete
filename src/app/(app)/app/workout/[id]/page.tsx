'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import WorkoutEditorScreen from '@/components/workouts/WorkoutEditorScreen';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';
import { stepFromSearch, type FinishStep } from '@/lib/workouts/finish-draft';

/**
 * /app/workout/[id] — the workout editor. Active sessions get the live
 * editor (timer + finish flow); completed sessions open in REVIEW mode
 * (edit sets/media after the fact). The finish flow's steps live in the
 * URL — ?step=summary, ?step=preview (?share=1 is its alias) — so Back
 * and Forward move one step. Owner-only; everyone else is sent back to
 * the profile.
 */

// useSearchParams must live under Suspense (house rule) — this tiny reader
// reports the STEP the URL asks for (Training fixes PR 4, Oct 21 2026):
// `?step=summary` (the questionnaire), `?step=preview` (preview and post),
// the Oct 2026 alias `?share=1` (the preview), nothing = the editor. It is
// the phase's source of truth: a step change is a history entry, so Back
// and Forward move one step, and a reload keeps the step. The editor mounts
// once the first answer is known and is never un-mounted on a later change
// (Back to the plain URL keeps its state).
function StepParamReader({ onRead }: { onRead: (step: FinishStep) => void }) {
  const searchParams = useSearchParams();
  const requested = searchParams.toString();
  useEffect(() => {
    onRead(stepFromSearch(requested));
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
  /** null until the URL's step has been read once (see StepParamReader); follows every later change. */
  const [step, setStep] = useState<FinishStep | null>(null);
  const handleStepParam = useCallback((next: FinishStep) => setStep(next), []);
  const userId = user?.id ?? null;

  // Signed out → the sign-in page, WITH the way back (workout capture round
  // PR 3, Oct 9 2026): after iOS throws the page away with the camera up and
  // the auth boot's 5 s timeout fires on gym signal, the athlete used to land
  // on `/` with no path back to the live workout. `/` honours `?next=`.
  useEffect(() => {
    if (!authLoading && !user && sessionId) {
      router.replace(`/?next=${encodeURIComponent(`/app/workout/${sessionId}`)}`);
    }
  }, [user, authLoading, router, sessionId]);

  // ONE load per (user, workout). Keyed on the user's ID, not the object: a
  // refocus or token refresh hands a new object with the same id and must not
  // re-fetch under a live editor — and a re-fetch that failed used to replace
  // a working editor with "Workout not found" (page.tsx:95). The owner check
  // and the error screen belong to the FIRST load only.
  const loadedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || !sessionId) return;
    const key = `${userId}:${sessionId}`;
    if (loadedForRef.current === key) return;
    loadedForRef.current = key;
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
        if (data.session.profile_id !== userId) {
          router.push('/athlete');
          return;
        }
        setSession(data.session);
      } catch (err) {
        if (!cancelled) {
          loadedForRef.current = null; // let a remount try again
          setError(err instanceof Error ? err.message : 'Failed to load workout');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, sessionId, router]);

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
        <StepParamReader onRead={handleStepParam} />
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
        ) : step === null ? null : (
          <WorkoutEditorScreen
            mode={mode}
            session={session}
            currentUserId={user.id}
            step={step}
          />
        )}
      </main>
    </div>
  );
}
