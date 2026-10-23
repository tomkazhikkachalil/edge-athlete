'use client';

// Personal records for every exercise (activities details A10, Oct 16 2026):
// the athlete's own all-time bests, derived from their sets
// (GET /api/workouts/prs — no PR table). Own profile only, like every
// workout read; weights in the unit the athlete logs most (the route says).

import { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import { formatPr, PR_SHORT_LABELS, type ExerciseBests, type PrKind } from '@/lib/workouts/prs';

const SHOWN = 8;

export default function ExerciseRecords() {
  const [bests, setBests] = useState<Array<[string, ExerciseBests]> | null>(null);
  const [all, setAll] = useState(false);
  const [unit, setUnit] = useState<'lb' | 'kg'>('lb');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/workouts/prs', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { bests: {} }))
      .then((d: { bests?: Record<string, ExerciseBests>; unit?: 'lb' | 'kg' }) => {
        if (cancelled) return;
        setUnit(d.unit === 'kg' ? 'kg' : 'lb');
        // A lift (heaviest / reps) or a hold (the longest time, Oct 23 2026).
        const rows = Object.entries(d.bests ?? {}).filter(([, b]) => b.heaviest !== null || b.reps !== null || (b.duration ?? null) !== null);
        rows.sort((a, b) => a[1].name.localeCompare(b[1].name));
        setBests(rows);
      })
      .catch(() => !cancelled && setBests([]));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!bests || bests.length === 0) return null;
  const rows = all ? bests : bests.slice(0, SHOWN);
  // The unit lives in the header, so the cells stay one short line at 375 px.
  const cell = (b: ExerciseBests, kind: PrKind) => ((b[kind] ?? null) !== null ? formatPr(kind, b[kind]!, unit, true) : '—');
  const unitLabel = unit === 'kg' ? 'kg' : 'lbs';
  return (
    <section className="tr-card p-4" data-exercise-records={bests.length}>
      <h3 className="flex items-center gap-2 text-sm font-bold text-primary mb-3">
        <Award className="w-4 h-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        Personal records
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 pr-3 font-semibold">Exercise</th>
              <th className="py-1 pr-3 font-semibold whitespace-nowrap">{PR_SHORT_LABELS.heaviest} ({unitLabel})</th>
              <th className="py-1 pr-3 font-semibold whitespace-nowrap">{PR_SHORT_LABELS.e1rm}</th>
              <th className="py-1 pr-3 font-semibold whitespace-nowrap">{PR_SHORT_LABELS.reps}</th>
              <th className="py-1 font-semibold whitespace-nowrap">{PR_SHORT_LABELS.duration}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, b]) => (
              <tr key={id} className="border-t border-border-subtle text-primary" data-exercise-record={id}>
                <td className="py-1.5 pr-3 font-medium">{b.name}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{cell(b, 'heaviest')}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{cell(b, 'e1rm')}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{cell(b, 'reps')}</td>
                <td className="py-1.5 whitespace-nowrap" data-exercise-record-duration={b.duration ?? ''}>{cell(b, 'duration')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bests.length > SHOWN && (
        <button type="button" onClick={() => setAll(v => !v)} className="ea-interactive mt-2 min-h-[44px] text-sm font-semibold text-brand-fg" data-exercise-records-more="">
          {all ? 'Show fewer' : `Show all ${bests.length}`}
        </button>
      )}
    </section>
  );
}
