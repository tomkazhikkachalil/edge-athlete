'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { refreshDrafts } from '@/hooks/useDrafts';
import type { WorkoutRoutine } from '@/lib/workouts/routines';
import { fetchJson, invalidate, readCached } from '@/lib/net/query-cache';

const ROUTINES_KEY = '/api/workout-routines';
/** A routine changes only when the viewer acts (and every door that acts refreshes). */
const ROUTINES_STALE_MS = 5 * 60_000;

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

  // Saved routines feed the Start Workout picker. Through the read cache
  // (performance program, Phase 2 — Nov 2026): the header mounts this hook
  // on every page, so the list used to be fetched on EVERY navigation; now
  // it is read once and kept five minutes, and every door that changes a
  // routine calls refreshRoutines() (invalidate + read). Inlined cancellable
  // IIFE so it stays out of the set-state-in-effect warning list.
  const [routinesReload, setRoutinesReload] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await readCached<{ routines?: WorkoutRoutine[] }>(
          ROUTINES_KEY,
          () => fetchJson<{ routines?: WorkoutRoutine[] }>(ROUTINES_KEY),
          { staleMs: ROUTINES_STALE_MS }
        );
        if (!cancelled) setRoutines(data.routines ?? []);
      } catch {
        /* keep whatever we had */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, routinesReload]);
  const refreshRoutines = () => {
    invalidate(ROUTINES_KEY);
    setRoutinesReload(k => k + 1);
  };

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
        // replace (Training fixes PR 4): the start screen leaves history — Back from the editor goes where Start was opened from, never "start another".
        router.replace(`/app/workout/${data.activeSessionId}`);
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
      router.replace(`/app/workout/${data.session.id}`);
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Failed to start workout');
      setStarting(false);
    }
  };

  // Every door lands on the start screen (nothing starts until its Start).
  const open = () => router.push('/app/workout/start');

  return { routines, refreshRoutines, starting, start, open };
}
