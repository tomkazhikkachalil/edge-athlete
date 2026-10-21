'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { refreshDrafts } from '@/hooks/useDrafts';
import type { WorkoutRoutine } from '@/lib/workouts/routines';

/**
 * ONE way to start a live workout (Create menu redesign, Oct 13 2026) —
 * lifted verbatim from TrainingTab so the header's Create → Record Activity →
 * Start a workout and Training's Start Workout are the SAME code: the same
 * `POST /api/workouts { mode: 'live', routineId? }`, the same 409 → resume
 * the workout in progress, the same `refreshDrafts()` (the resume pill and
 * the Drafts count learn the session now), the same `/app/workout/<id>`.
 * Program E2 (Oct 2026): every door's `open()` is the start SCREEN
 * (`/app/workout/start` — the title, the routine, the clock, the records
 * line, an in-progress banner) and nothing is written until its Start;
 * `start(routineId, { title, timed })` is the one POST. The routines read
 * feeds that screen (`enabled` gates it; a failure just hides the list).
 */
export function useStartWorkout(enabled: boolean) {
  const router = useRouter();
  const { showError } = useToast();
  const [starting, setStarting] = useState(false);
  const [routines, setRoutines] = useState<WorkoutRoutine[]>([]);

  // Saved routines feed the Start Workout picker. Inlined cancellable IIFE
  // (not a callback call) so it stays out of the set-state-in-effect warning
  // list; event handlers refresh by bumping routinesReload.
  const [routinesReload, setRoutinesReload] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/workout-routines', { credentials: 'include' });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setRoutines(data.routines ?? []);
      } catch {
        /* keep whatever we had */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, routinesReload]);
  const refreshRoutines = () => setRoutinesReload(k => k + 1);

  const start = async (routineId: string | null = null, opts: { title?: string; timed?: boolean } = {}) => {
    if (starting) return;
    setStarting(true);
    try {
      const title = opts.title?.trim();
      const response = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode: 'live',
          ...(routineId ? { routineId } : {}),
          ...(title ? { title } : {}),
          ...(typeof opts.timed === 'boolean' ? { timed: opts.timed } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 409 && data?.activeSessionId) {
        showError('Workout in progress', 'Resuming your workout in progress.');
        void refreshDrafts();
        router.push(`/app/workout/${data.activeSessionId}`);
        return;
      }
      if (routineId && response.status === 404) {
        // Deleted between opening the sheet and tapping it
        showError('Routine not found', 'That routine no longer exists.');
        refreshRoutines();
        setStarting(false);
        return;
      }
      if (!response.ok) throw new Error(data?.error || 'Failed to start workout');
      // The session exists: the resume pill and the Drafts count learn it now.
      void refreshDrafts();
      router.push(`/app/workout/${data.session.id}`);
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Failed to start workout');
      setStarting(false);
    }
  };

  // Every door lands on the start screen (nothing starts until its Start).
  const open = () => router.push('/app/workout/start');

  return { routines, refreshRoutines, starting, start, open };
}
