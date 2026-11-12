'use client';

// Add a tested max (Training redesign PR 6, Nov 11 2026): a best the athlete
// types in — a max tested with a coach, a lift from before they logged here.
// It is a dated entry that counts beside the logged sets (tested-max.ts).
// With no `exercise` it asks which one (the catalog's strength exercises);
// on an exercise's own page it already knows.

import { useState } from 'react';
import { EXERCISE_CATALOG, EXERCISE_MAP } from '@/lib/workout-config';
import { TESTED_MAX_SOURCE } from '@/lib/workouts/tested-max';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const STRENGTH = EXERCISE_CATALOG.filter(e => e.category === 'strength');

interface TestedMaxFormProps {
  /** The exercise this is for; absent = the form asks. */
  exercise?: { ref: string; name: string };
  defaultUnit: 'lb' | 'kg';
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (ref: string) => void;
  onCancel: () => void;
}

export default function TestedMaxForm({ exercise, defaultUnit, onDirtyChange, onSaved, onCancel }: TestedMaxFormProps) {
  const [ref, setRef] = useState(exercise?.ref ?? '');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<'lbs' | 'kg'>(defaultUnit === 'kg' ? 'kg' : 'lbs');
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const def = EXERCISE_MAP[ref];
  const reps = def?.inputMode === 'reps_only';
  const name = exercise?.name ?? def?.label ?? '';
  const touch = (next: string) => {
    setValue(next);
    onDirtyChange(next.trim() !== '');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const n = Number(value.trim());
    if (!ref || !name) return setError('Choose the exercise.');
    if (!value.trim() || !Number.isFinite(n) || n <= 0) return setError(reps ? 'Enter the reps as a number above zero.' : 'Enter the weight as a number above zero.');
    if (!date || date > today()) return setError('Choose a date that is not in the future.');
    setSaving(true);
    try {
      const shownUnit = reps ? 'reps' : unit;
      const res = await fetch('/api/vitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ metric_key: ref, metric_category: 'strength', metric_label: name, value: reps ? Math.round(n) : n, value_display: `${reps ? Math.round(n) : n} ${shownUnit}`, unit: shownUnit, recorded_at: date, source: TESTED_MAX_SOURCE }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || 'Could not save it. Check your connection and try again.');
        return;
      }
      onDirtyChange(false);
      onSaved(ref);
    } catch {
      setError('Could not save it. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full min-h-[44px] rounded-lg border border-border-strong bg-surface px-3 text-base text-primary';
  return (
    <form onSubmit={save} className="ea-surface rounded-lg p-4 space-y-3" data-tested-max-form="">
      <p className="text-sm font-bold text-primary">Add a tested max</p>
      <p className="text-xs text-muted">A best you did not log as a workout — it counts toward this exercise&apos;s bests from its date.</p>
      {!exercise && (
        <label className="block text-xs font-semibold text-secondary">
          Exercise
          <select value={ref} onChange={e => setRef(e.target.value)} className={`${field} mt-1`} data-tested-max-exercise="">
            <option value="">Choose…</option>
            {STRENGTH.map(e => (
              <option key={e.key} value={e.key}>{e.label}</option>
            ))}
          </select>
        </label>
      )}
      <div className="flex gap-3">
        <label className="block flex-1 text-xs font-semibold text-secondary">
          {reps ? 'Reps' : 'Weight'}
          <input type="text" inputMode="decimal" value={value} onChange={e => touch(e.target.value)} placeholder={reps ? 'e.g. 15' : 'e.g. 225'} className={`${field} mt-1`} data-tested-max-value="" />
        </label>
        {!reps && (
          <label className="block w-24 text-xs font-semibold text-secondary">
            Unit
            <select value={unit} onChange={e => setUnit(e.target.value === 'kg' ? 'kg' : 'lbs')} className={`${field} mt-1`} data-tested-max-unit="">
              <option value="lbs">lbs</option>
              <option value="kg">kg</option>
            </select>
          </label>
        )}
      </div>
      <label className="block text-xs font-semibold text-secondary">
        Date
        <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} className={`${field} mt-1`} data-tested-max-date="" />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="ea-cta min-h-[44px] rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-60" data-tested-max-save="">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="ea-interactive min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold text-primary">
          Cancel
        </button>
      </div>
    </form>
  );
}
