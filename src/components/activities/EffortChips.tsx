'use client';

// How hard was it? 1–10 (activities details, Oct 16 2026): two rows of five
// chips, each at least 44 px (Tom's review); the chosen one again clears it.
// One control for every Finish — an activity's and a workout's.

import { useId } from 'react';
import { EFFORT_LABELS, EFFORT_MAX } from '@/lib/activities/details';

const chip = (on: boolean) =>
  `ea-interactive min-h-[44px] min-w-[44px] rounded-lg border px-3 text-sm font-semibold tabular-nums ${on ? 'border-brand bg-brand-soft text-brand-fg' : 'border-border text-primary'}`;

export default function EffortChips({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const labelId = useId();
  return (
    <div data-finish-effort={value ?? ''}>
      <p className="text-sm font-medium text-secondary" id={labelId}>
        How hard was it? <span className="font-normal text-muted">optional</span>
      </p>
      <div className="mt-1 grid grid-cols-5 gap-1.5" role="radiogroup" aria-labelledby={labelId}>
        {Array.from({ length: EFFORT_MAX }, (_, i) => i + 1).map(n => (
          <button
            key={n}
            type="button"
            role="radio"
            disabled={disabled}
            aria-checked={value === n}
            aria-label={`${n}${EFFORT_LABELS[n] ? ` — ${EFFORT_LABELS[n]}` : ''}`}
            onClick={() => onChange(value === n ? null : n)}
            className={chip(value === n)}
            data-effort={n}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="mt-1 flex justify-between text-xs text-muted" aria-hidden="true">
        <span>1 · {EFFORT_LABELS[1]}</span>
        <span>5 · {EFFORT_LABELS[5]}</span>
        <span>10 · {EFFORT_LABELS[10]}</span>
      </p>
    </div>
  );
}
