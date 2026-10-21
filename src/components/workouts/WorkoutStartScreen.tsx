'use client';

/**
 * /app/workout/start — the Workout's set-up step (Program E2, Oct 2026;
 * Tom: the Workout gets the set-up step too). A title, the routine (an
 * empty workout or a saved one), whether to time it (remembered on this
 * device), what will be recorded, and a banner when one is already in
 * progress. NOTHING IS WRITTEN BEFORE START: no draft, no row — the row and
 * its clock are born at the Start tap (useStartWorkout.start). Every door
 * that used to open the routine picker lands here.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { backOr } from '@/lib/nav-back';
import { useDrafts } from '@/hooks/useDrafts';
import { useStartWorkout } from '@/hooks/useStartWorkout';
import { readTimedDefault, writeTimedDefault } from '@/lib/workouts/timer-prefs';

export default function WorkoutStartScreen() {
  const router = useRouter();
  const { routines, starting, start } = useStartWorkout(true);
  const drafts = useDrafts(true);
  const inProgress = drafts.inProgress.find(d => d.kind === 'workout') ?? null;
  const [title, setTitle] = useState('');
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [timed, setTimed] = useState<boolean>(() => readTimedDefault());
  const chosen = routineId ? routines.find(r => r.id === routineId) ?? null : null;

  const go = () => {
    writeTimedDefault(timed);
    void start(routineId, { title, timed });
  };

  return (
    <div className="min-h-screen bg-canvas pb-28" data-workout-start-screen="">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface/95 px-2 py-2 backdrop-blur pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <button type="button" onClick={() => backOr(router, '/athlete?tab=training')} className="ea-icon-btn inline-flex items-center justify-center text-primary" aria-label="Back" data-workout-start-back="">
          <i className="fas fa-arrow-left text-lg" aria-hidden="true"></i>
        </button>
        <h1 className="flex-1 truncate text-base font-bold text-primary">Start a workout</h1>
      </header>

      <main className="mx-auto max-w-xl px-4 py-4 space-y-5">
        {inProgress && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100" role="status" data-workout-start-in-progress={inProgress.id}>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">A workout is in progress</span>
              <span className="block truncate">{inProgress.title}</span>
            </span>
            <Link href={inProgress.href} className="ea-interactive shrink-0 rounded-lg border border-amber-700/40 px-3 py-2 text-sm font-semibold" data-workout-start-resume="">
              Resume
            </Link>
          </div>
        )}

        <label className="block">
          <span className="text-sm font-medium text-secondary">Workout title <span className="font-normal text-muted">optional</span></span>
          <input
            type="text"
            value={title}
            maxLength={120}
            onChange={e => setTitle(e.target.value)}
            placeholder={chosen ? chosen.name : 'My workout'}
            className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base text-primary"
            data-workout-start-title=""
          />
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-secondary">Start from</legend>
          <div className="mt-2 space-y-2" role="radiogroup" aria-label="Start from" data-workout-start-routines="">
            <button
              type="button"
              role="radio"
              aria-checked={routineId === null}
              onClick={() => setRoutineId(null)}
              className={`ea-interactive flex min-h-[56px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left ${routineId === null ? 'border-brand bg-brand-soft' : 'border-border bg-surface'}`}
              data-workout-start-routine="empty"
            >
              <i className="fas fa-play w-5 text-center text-brand-fg" aria-hidden="true"></i>
              <span className="min-w-0">
                <span className="block font-semibold text-primary">Empty workout</span>
                <span className="block text-xs text-muted">Add exercises as you go</span>
              </span>
            </button>
            {routines.map(r => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={routineId === r.id}
                onClick={() => setRoutineId(r.id)}
                className={`ea-interactive flex min-h-[56px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left ${routineId === r.id ? 'border-brand bg-brand-soft' : 'border-border bg-surface'}`}
                data-workout-start-routine={r.id}
              >
                <i className="fas fa-list-check w-5 text-center text-brand-fg" aria-hidden="true"></i>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-primary">{r.name}</span>
                  <span className="block text-xs text-muted">
                    {r.exercises.length} {r.exercises.length === 1 ? 'exercise' : 'exercises'} — sets ready, you fill in the numbers
                  </span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          role="switch"
          aria-checked={timed}
          onClick={() => setTimed(t => !t)}
          className="flex min-h-[56px] w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left"
          data-workout-start-timed={timed ? 'on' : 'off'}
        >
          <i className={`fas fa-stopwatch w-5 text-center ${timed ? 'text-brand-fg' : 'text-tertiary'}`} aria-hidden="true"></i>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-primary">Time this workout</span>
            <span className="block text-sm text-secondary">{timed ? 'The clock runs from Start; pauses are excluded.' : 'No clock — the sets and reps are recorded, not the time.'}</span>
          </span>
          <span className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full ${timed ? 'bg-brand' : 'bg-gray-300 dark:bg-stone-700'}`} aria-hidden="true">
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${timed ? 'translate-x-6' : 'translate-x-1'}`} />
          </span>
        </button>

        <p className="text-sm text-secondary" data-workout-start-records="">
          <span className="font-semibold text-primary">What will be recorded:</span> sets, reps and weight{timed ? ' · the clock, pauses excluded' : ''} · rest per set · photos · records for every exercise.
        </p>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-xl">
          <button type="button" onClick={go} disabled={starting} className="ea-cta inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl text-base font-semibold text-white disabled:opacity-50" data-workout-start="">
            <i className="fas fa-play" aria-hidden="true"></i> {starting ? 'Starting…' : inProgress ? 'Start another' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}
