'use client';

import { Play, X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import type { WorkoutRoutine } from '@/lib/workouts/routines';

/**
 * Start-workout picker: an empty session or one seeded from a saved routine.
 * Only shown when the user has routines — zero-routine users keep the
 * one-tap Start Workout. AddExerciseSheet bottom-sheet shell.
 */

interface StartWorkoutSheetProps {
  routines: WorkoutRoutine[];
  starting: boolean;
  /** null = start an empty workout */
  onStart: (routineId: string | null) => void;
  onClose: () => void;
}

export default function StartWorkoutSheet({
  routines, starting, onStart, onClose,
}: StartWorkoutSheetProps) {
  useBodyScrollLock(true);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-surface-raised rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md max-h-modal overflow-hidden flex flex-col modal-sheet-bottom">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-lg font-bold text-primary">Start Workout</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center text-faint hover:text-tertiary transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Options */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 pb-4">
          <button
            type="button"
            onClick={() => onStart(null)}
            disabled={starting}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left hover:bg-brand-soft transition-colors disabled:opacity-50"
          >
            <span className="shrink-0 w-10 h-10 rounded-full bg-brand-soft flex items-center justify-center">
              <Play className="w-5 h-5 text-brand-fg" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-base font-bold text-primary">Empty workout</span>
              <span className="block text-xs text-muted">Add exercises as you go</span>
            </span>
          </button>

          <p className="px-3 pt-3 pb-1.5 text-xs font-semibold text-faint uppercase tracking-wider">
            Your routines
          </p>
          {routines.map(routine => (
            <button
              key={routine.id}
              type="button"
              onClick={() => onStart(routine.id)}
              disabled={starting}
              className="w-full px-3 py-3 rounded-lg text-left hover:bg-brand-soft transition-colors disabled:opacity-50"
            >
              <span className="block text-base font-semibold text-primary truncate">{routine.name}</span>
              <span className="block text-xs text-muted">
                {routine.exercises.length} {routine.exercises.length === 1 ? 'exercise' : 'exercises'}
                {' — sets ready, you fill in the numbers'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
