'use client';

import { useState } from 'react';
import { X, ArrowUp, ArrowDown, Minus, Plus } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import AddExerciseSheet from './AddExerciseSheet';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { COPY } from '@/lib/copy';
import {
  MAX_ROUTINE_EXERCISES,
  MAX_ROUTINE_NAME,
  MAX_TARGET_SETS,
  type RoutineExercise,
  type WorkoutRoutine,
} from '@/lib/workouts/routines';

/**
 * Create/edit a saved workout routine: name, ordered exercises, planned set
 * count each. EquipmentSettingsModal pattern: mount a FRESH instance per open
 * (state seeds from props), scrolling body, pinned footer, every user close
 * path through useDirtyClose. AddExerciseSheet stacks above this modal by
 * DOM order (both z-50); ConfirmModal stacks above both at z-[60].
 */

interface RoutineEditorModalProps {
  /** null = create a new routine */
  routine: WorkoutRoutine | null;
  onClose: () => void;
  /** Called with the saved routine; caller refreshes its list. */
  onSaved: (routine: WorkoutRoutine) => void;
}

export default function RoutineEditorModal({ routine, onClose, onSaved }: RoutineEditorModalProps) {
  const [name, setName] = useState(routine?.name ?? '');
  const [exercises, setExercises] = useState<RoutineExercise[]>(routine?.exercises ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAddSheet, setShowAddSheet] = useState(false);

  useBodyScrollLock(true);

  const isDirty = () =>
    JSON.stringify({ name, exercises }) !==
    JSON.stringify({ name: routine?.name ?? '', exercises: routine?.exercises ?? [] });

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } =
    useDirtyClose(isDirty, onClose);

  const move = (index: number, delta: -1 | 1) => {
    setExercises(prev => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const remove = (index: number) => {
    setExercises(prev => prev.filter((_, i) => i !== index));
  };

  const stepSets = (index: number, delta: -1 | 1) => {
    setExercises(prev =>
      prev.map((exercise, i) =>
        i === index
          ? {
              ...exercise,
              targetSets: Math.min(Math.max(exercise.targetSets + delta, 1), MAX_TARGET_SETS),
            }
          : exercise
      )
    );
  };

  const handleSave = async () => {
    if (name.trim().length === 0) {
      setError('Give your routine a name');
      return;
    }
    if (exercises.length === 0) {
      setError('Add at least one exercise');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(
        routine ? `/api/workout-routines/${routine.id}` : '/api/workout-routines',
        {
          method: routine ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name: name.trim(), exercises }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Failed to save routine');
        return;
      }
      onSaved(data.routine);
      // Successful save closes directly — never the discard prompt.
      onClose();
    } catch (e) {
      console.error('Failed to save routine:', e);
      setError('Failed to save routine');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className="bg-surface-raised rounded-xl shadow-xl max-w-lg w-full max-h-modal flex flex-col">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border">
          <h2 className="text-lg font-bold text-primary">
            {routine ? 'Edit routine' : 'New routine'}
          </h2>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="ea-icon-btn inline-flex items-center justify-center"
          >
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-6">
          <label className="block">
            <span className="block text-sm font-semibold text-primary mb-1">Name</span>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              maxLength={MAX_ROUTINE_NAME}
              placeholder="e.g. Push Day"
              className="w-full px-3 py-2.5 border border-border-strong rounded-lg text-base bg-surface focus:outline-none"
            />
          </label>

          <fieldset>
            <legend className="text-sm font-semibold text-primary mb-1">Exercises</legend>
            <p className="text-xs text-muted mb-3">
              Sets is how many empty sets each workout starts with — you fill in reps and
              weight during the session.
            </p>
            {exercises.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-sm text-muted text-center">
                No exercises yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {exercises.map((exercise, index) => (
                  <li
                    key={`${exercise.name}-${index}`}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-primary">
                      {exercise.name}
                    </span>
                    <span
                      className="flex items-center gap-0.5"
                      aria-label={`${exercise.name}: ${exercise.targetSets} sets`}
                    >
                      <button
                        onClick={() => stepSets(index, -1)}
                        disabled={exercise.targetSets <= 1}
                        aria-label={`Fewer sets for ${exercise.name}`}
                        className="ea-interactive flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30"
                      >
                        <Minus className="w-4 h-4 text-tertiary" />
                      </button>
                      <span className="w-10 text-center text-xs font-semibold text-secondary">
                        {exercise.targetSets} {exercise.targetSets === 1 ? 'set' : 'sets'}
                      </span>
                      <button
                        onClick={() => stepSets(index, 1)}
                        disabled={exercise.targetSets >= MAX_TARGET_SETS}
                        aria-label={`More sets for ${exercise.name}`}
                        className="ea-interactive flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30"
                      >
                        <Plus className="w-4 h-4 text-tertiary" />
                      </button>
                    </span>
                    <button
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${exercise.name} up`}
                      className="ea-interactive hidden sm:flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30"
                    >
                      <ArrowUp className="w-4 h-4 text-tertiary" />
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === exercises.length - 1}
                      aria-label={`Move ${exercise.name} down`}
                      className="ea-interactive hidden sm:flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30"
                    >
                      <ArrowDown className="w-4 h-4 text-tertiary" />
                    </button>
                    <button
                      onClick={() => remove(index)}
                      aria-label={`Remove ${exercise.name}`}
                      className="ea-interactive flex h-8 w-8 items-center justify-center rounded-lg"
                    >
                      <X className="w-4 h-4 text-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => setShowAddSheet(true)}
              disabled={exercises.length >= MAX_ROUTINE_EXERCISES}
              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-brand-fg-strong bg-brand-soft hover:bg-violet-100 dark:hover:bg-violet-900/60 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add exercise
            </button>
          </fieldset>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 sm:px-6 py-4 border-t border-border bg-surface-muted">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
            <button
              onClick={requestClose}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-secondary bg-surface border border-border-strong hover:bg-surface-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save routine'}
            </button>
          </div>
        </div>
      </div>

      <AddExerciseSheet
        isOpen={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        onAdd={exercise =>
          setExercises(prev => [
            ...prev,
            {
              name: exercise.name,
              exerciseKey: exercise.exerciseKey,
              category: exercise.category,
              notes: exercise.notes,
              targetSets: 3,
            },
          ])
        }
      />

      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText="Keep editing"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
        overlayZClass="z-[60]"
      />
    </div>
  );
}
