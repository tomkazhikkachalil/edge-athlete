'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { refreshDrafts } from '@/hooks/useDrafts';
import type { WorkoutRoutine } from '@/lib/workouts/routines';

/**
 * ONE way to start a live workout (Create menu redesign, Oct 13 2026) —
 * lifted verbatim from VitalsTab so the header's Create → Record Activity →
 * Start a workout and Vitals' Start Workout are the SAME code: the same
 * `POST /api/workouts { mode: 'live', routineId? }`, the same 409 → resume
 * the workout in progress, the same `refreshDrafts()` (the resume pill and
 * the Drafts count learn the session now), the same `/app/workout/<id>`.
 * With saved routines `open()` shows the picker (`StartWorkoutSheet`,
 * rendered by the caller from `showStartSheet`); without, one-tap start.
 *
 * `enabled` gates the routines read (Vitals: the owner's own profile; the
 * header: a signed-in person) — a failure just degrades to the one-tap start.
 */
export function useStartWorkout(enabled: boolean) {
  const router = useRouter();
  const { showError } = useToast();
  const [starting, setStarting] = useState(false);
  const [routines, setRoutines] = useState<WorkoutRoutine[]>([]);
  const [showStartSheet, setShowStartSheet] = useState(false);

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

  const start = async (routineId: string | null = null) => {
    if (starting) return;
    setStarting(true);
    try {
      const response = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: 'live', ...(routineId ? { routineId } : {}) }),
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
        setShowStartSheet(false);
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

  // With saved routines the door opens the picker; without, one-tap start.
  const open = () => {
    if (routines.length > 0) setShowStartSheet(true);
    else void start();
  };

  return { routines, refreshRoutines, starting, showStartSheet, setShowStartSheet, start, open };
}
