'use client';

import { newId } from '@/lib/ids';
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
  /** PR 3: pick SEVERAL for a superset / circuit — taps collect, the footer creates. `min` picks before the footer enables (2 for a new group, 1 when adding to one or seeding from an exercise). */
  multi?: { title: string; hint: string; min: number; cta: (count: number) => string; onAddMany: (exercises: EntryExercise[]) => void } | null;
}

/** Bottom sheet: search the catalog or add a custom exercise (or several, for a group). */
export default function AddExerciseSheet({ isOpen, onClose, onAdd, multi = null }: AddExerciseSheetProps) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<EntryExercise[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useBodyScrollLock(isOpen);

  // Query reset is synchronisation (render phase); focusing the DOM is a real
  // side effect and stays in an effect.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setQuery('');
      setPicked([]);
    }
  }

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const results = searchCatalog(query);
  const grouped = (['strength', 'cardio', 'mobility'] as ExerciseCategory[])
    .map(category => ({ category, exercises: results.filter(e => e.category === category) }))
    .filter(group => group.exercises.length > 0);

  const take = (exercise: EntryExercise) => {
    if (multi) {
      setPicked(prev => [...prev, exercise]);
      setQuery('');
      inputRef.current?.focus();
      return;
    }
    onAdd(exercise);
    onClose();
  };
  const pick = (exercise: CatalogExercise) => take({ clientId: newId(), name: exercise.label, exerciseKey: exercise.key, category: exercise.category, notes: null, sets: [] });
  const addCustom = () => {
    const name = query.trim().slice(0, 80);
    if (!name) return;
    take({ clientId: newId(), name, exerciseKey: null, category: 'other', notes: null, sets: [] });
  };
  const createGroup = () => {
    if (!multi || picked.length < multi.min) return;
    multi.onAddMany(picked);
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
            <h2 className="text-lg font-bold text-primary">{multi ? multi.title : 'Add Exercise'}</h2>
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 flex items-center justify-center text-faint hover:text-tertiary transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {multi && (
            <div className="mb-3" data-group-picks={picked.length}>
              <p className="text-xs text-secondary">{multi.hint}</p>
              {picked.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {picked.map((p, i) => (
                    <li key={p.clientId}>
                      <button type="button" onClick={() => setPicked(prev => prev.filter((_, k) => k !== i))} className="ea-interactive inline-flex min-h-[32px] items-center gap-1 rounded-full bg-brand-soft px-3 text-xs font-semibold text-brand-fg-strong" aria-label={`Remove ${p.name} from the picks`}>
                        {i + 1}. {p.name} <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
        {multi && (
          <div className="shrink-0 border-t border-border-subtle p-3">
            <button type="button" onClick={createGroup} disabled={picked.length < multi.min} className="ea-cta w-full min-h-[48px] rounded-xl text-base font-semibold text-white disabled:opacity-50" data-group-create="">
              {multi.cta(picked.length)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
