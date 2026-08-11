'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import {
  searchCatalog,
  EXERCISE_CATEGORY_LABELS,
  type CatalogExercise,
  type ExerciseCategory,
} from '@/lib/workout-config';
import type { EntryExercise } from '@/lib/workouts/entries';

interface AddExerciseSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (exercise: EntryExercise) => void;
}

/** Bottom sheet: search the catalog or add a custom exercise. */
export default function AddExerciseSheet({ isOpen, onClose, onAdd }: AddExerciseSheetProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useBodyScrollLock(isOpen);

  // Query reset is synchronisation (render phase); focusing the DOM is a real
  // side effect and stays in an effect.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) setQuery('');
  }

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const results = searchCatalog(query);
  const grouped = (['strength', 'cardio', 'mobility'] as ExerciseCategory[])
    .map(category => ({ category, exercises: results.filter(e => e.category === category) }))
    .filter(group => group.exercises.length > 0);

  const pick = (exercise: CatalogExercise) => {
    onAdd({
      name: exercise.label,
      exerciseKey: exercise.key,
      category: exercise.category,
      notes: null,
      sets: [],
    });
    onClose();
  };

  const addCustom = () => {
    const name = query.trim().slice(0, 80);
    if (!name) return;
    onAdd({ name, exerciseKey: null, category: 'other', notes: null, sets: [] });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      {/* h-dvh (capped by max-h-modal) pins the phone sheet at full height: a
          content-sized sheet would collapse as the query narrows and sink —
          bottom-anchored — behind the keyboard, since iOS keeps the layout
          viewport full-size. Same reasoning as GifPickerModal. */}
      <div className="bg-surface-raised rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md h-dvh sm:h-auto max-h-modal overflow-hidden flex flex-col modal-sheet-bottom">
        {/* Header + search */}
        <div className="shrink-0 p-4 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-primary">Add Exercise</h2>
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 flex items-center justify-center text-faint hover:text-tertiary transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search exercises…"
              className="w-full pl-9 pr-3 py-2.5 border border-border-strong rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
        </div>

        {/* Catalog list */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2">
          {grouped.map(group => (
            <div key={group.category} className="mb-2">
              <p className="px-3 py-1.5 text-xs font-semibold text-faint uppercase tracking-wider">
                {EXERCISE_CATEGORY_LABELS[group.category]}
              </p>
              {group.exercises.map(exercise => (
                <button
                  key={exercise.key}
                  type="button"
                  onClick={() => pick(exercise)}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-base text-primary hover:bg-brand-soft transition-colors"
                >
                  {exercise.label}
                </button>
              ))}
            </div>
          ))}

          {query.trim().length > 0 && (
            <button
              type="button"
              onClick={addCustom}
              className="w-full flex items-center gap-2 px-3 py-3 mt-1 rounded-lg text-base font-semibold text-brand-fg-strong bg-brand-soft hover:bg-violet-100 dark:hover:bg-violet-900/60 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add &ldquo;{query.trim().slice(0, 40)}&rdquo; as custom exercise
            </button>
          )}

          {grouped.length === 0 && query.trim().length === 0 && (
            <p className="px-3 py-6 text-sm text-muted text-center">No exercises found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
