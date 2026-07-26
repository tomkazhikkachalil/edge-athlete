'use client';

import { Check, Copy, Plus, StickyNote, Trash2, X } from 'lucide-react';
import { EXERCISE_MAP, type ExerciseInputMode } from '@/lib/workout-config';
import type { EntryExercise, EntrySet } from '@/lib/workouts/entries';
import { MAX_SETS_PER_EXERCISE } from '@/lib/workouts/entries';

const CATEGORY_ICON: Record<EntryExercise['category'], string> = {
  strength: '🏋️',
  cardio: '🏃',
  mobility: '🧘',
  other: '💪',
};

export function emptySet(setNumber: number): EntrySet {
  return {
    setNumber,
    reps: null,
    weight: null,
    weightUnit: null,
    durationSeconds: null,
    distance: null,
    distanceUnit: null,
    completedAt: null,
    media: [],
  };
}

function inputModeFor(exercise: EntryExercise): ExerciseInputMode {
  if (exercise.exerciseKey && EXERCISE_MAP[exercise.exerciseKey]) {
    return EXERCISE_MAP[exercise.exerciseKey].inputMode;
  }
  return 'reps_weight';
}

const numOrNull = (raw: string, max: number): number | null => {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, max);
};

interface SetRowProps {
  set: EntrySet;
  inputMode: ExerciseInputMode;
  onChange: (next: EntrySet) => void;
  onDelete: () => void;
}

function SetRow({ set, inputMode, onChange, onDelete }: SetRowProps) {
  const patch = (partial: Partial<EntrySet>) => onChange({ ...set, ...partial });
  const done = set.completedAt !== null;

  const durationMin = set.durationSeconds !== null ? Math.floor(set.durationSeconds / 60) : null;
  const durationSec = set.durationSeconds !== null ? set.durationSeconds % 60 : null;
  const setDuration = (min: number | null, sec: number | null) => {
    if (min === null && sec === null) {
      patch({ durationSeconds: null });
      return;
    }
    patch({ durationSeconds: (min ?? 0) * 60 + (sec ?? 0) });
  };

  const numberInput = (
    value: number | null,
    onValue: (v: number | null) => void,
    placeholder: string,
    max: number,
    width = 'w-16'
  ) => (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={max}
      value={value ?? ''}
      onChange={e => onValue(numOrNull(e.target.value, max))}
      placeholder={placeholder}
      className={`${width} px-2 py-2 border border-gray-300 rounded-lg text-base text-center focus:outline-none focus:ring-2 focus:ring-violet-500`}
      aria-label={placeholder}
    />
  );

  return (
    <div className={`flex items-center gap-2 py-1.5 ${done ? 'opacity-80' : ''}`}>
      <span className="w-6 text-sm font-semibold text-gray-400 text-center shrink-0">
        {set.setNumber}
      </span>

      <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
        {(inputMode === 'reps_weight' || inputMode === 'reps_only') &&
          numberInput(set.reps, v => patch({ reps: v }), 'reps', 1000)}

        {inputMode === 'reps_weight' && (
          <>
            {numberInput(set.weight, v => patch({ weight: v, weightUnit: set.weightUnit ?? 'lbs' }), 'wt', 5000, 'w-20')}
            <button
              type="button"
              onClick={() => patch({ weightUnit: set.weightUnit === 'kg' ? 'lbs' : 'kg' })}
              className="px-2 py-2 min-w-[44px] text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              aria-label="Toggle weight unit"
            >
              {set.weightUnit ?? 'lbs'}
            </button>
          </>
        )}

        {(inputMode === 'duration' || inputMode === 'distance_duration') && (
          <div className="flex items-center gap-1">
            {numberInput(durationMin, v => setDuration(v, durationSec), 'min', 1440, 'w-14')}
            <span className="text-gray-400 text-sm">:</span>
            {numberInput(durationSec, v => setDuration(durationMin, v === null ? null : Math.min(v, 59)), 'sec', 59, 'w-14')}
          </div>
        )}

        {inputMode === 'distance_duration' && (
          <>
            {numberInput(set.distance, v => patch({ distance: v, distanceUnit: set.distanceUnit ?? 'mi' }), 'dist', 1000000, 'w-16')}
            <select
              value={set.distanceUnit ?? 'mi'}
              onChange={e => patch({ distanceUnit: e.target.value as EntrySet['distanceUnit'] })}
              className="px-1 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
              aria-label="Distance unit"
            >
              <option value="mi">mi</option>
              <option value="km">km</option>
              <option value="m">m</option>
              <option value="yd">yd</option>
            </select>
          </>
        )}
      </div>

      {/* Complete toggle — stamps completedAt (drives the rest indicator) */}
      <button
        type="button"
        onClick={() => patch({ completedAt: done ? null : new Date().toISOString() })}
        className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-colors ${
          done ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
        }`}
        aria-label={done ? 'Mark set incomplete' : 'Mark set complete'}
      >
        <Check className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={onDelete}
        className="w-8 h-11 shrink-0 flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors"
        aria-label="Delete set"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

interface ExerciseCardProps {
  exercise: EntryExercise;
  onChange: (next: EntryExercise) => void;
  onDelete: () => void;
}

export default function ExerciseCard({ exercise, onChange, onDelete }: ExerciseCardProps) {
  const inputMode = inputModeFor(exercise);
  const showNotes = exercise.notes !== null;

  const updateSet = (index: number, next: EntrySet) => {
    const sets = exercise.sets.map((s, i) => (i === index ? next : s));
    onChange({ ...exercise, sets });
  };

  const deleteSet = (index: number) => {
    const sets = exercise.sets
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, setNumber: i + 1 }));
    onChange({ ...exercise, sets });
  };

  const addSet = () => {
    if (exercise.sets.length >= MAX_SETS_PER_EXERCISE) return;
    const previous = exercise.sets[exercise.sets.length - 1];
    const clone: EntrySet = previous
      ? { ...previous, setNumber: exercise.sets.length + 1, completedAt: null }
      : emptySet(1);
    onChange({ ...exercise, sets: [...exercise.sets, clone] });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl" aria-hidden="true">{CATEGORY_ICON[exercise.category]}</span>
        <h3 className="text-base font-bold text-gray-900 flex-1 min-w-0 truncate">{exercise.name}</h3>
        <button
          type="button"
          onClick={() => onChange({ ...exercise, notes: showNotes ? null : '' })}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
            showNotes ? 'bg-violet-100 text-violet-600' : 'text-gray-300 hover:text-gray-500'
          }`}
          aria-label="Toggle exercise notes"
        >
          <StickyNote className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors"
          aria-label={`Delete ${exercise.name}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {showNotes && (
        <input
          type="text"
          value={exercise.notes ?? ''}
          onChange={e => onChange({ ...exercise, notes: e.target.value.slice(0, 500) })}
          placeholder="Notes (tempo, cues, how it felt…)"
          className="w-full mb-2 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      )}

      <div className="divide-y divide-gray-50">
        {exercise.sets.map((set, index) => (
          <SetRow
            key={index}
            set={set}
            inputMode={inputMode}
            onChange={next => updateSet(index, next)}
            onDelete={() => deleteSet(index)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addSet}
        disabled={exercise.sets.length >= MAX_SETS_PER_EXERCISE}
        className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
      >
        {exercise.sets.length > 0 ? <Copy className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
        {exercise.sets.length > 0 ? 'Add set (copies last)' : 'Add first set'}
      </button>
    </div>
  );
}
