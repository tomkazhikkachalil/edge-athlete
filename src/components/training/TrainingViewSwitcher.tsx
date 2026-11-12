'use client';

import { TRAINING_VIEWS, type TrainingView } from '@/lib/training/views';

/**
 * Training's four views (Training redesign PR 3, Nov 11 2026): one row of
 * tabs under the heading. It scrolls sideways before it wraps — four labels
 * fit a 375 px phone, a larger text size still reaches every one.
 */
export default function TrainingViewSwitcher({ view, onChange }: { view: TrainingView; onChange: (view: TrainingView) => void }) {
  return (
    <div role="tablist" aria-label="Training views" className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" data-training-views={view}>
      {TRAINING_VIEWS.map(v => {
        const active = v.id === view;
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v.id)}
            className={`tr-pill shrink-0 min-h-[40px] rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
              active ? 'bg-brand text-white' : 'border border-border-strong text-secondary hover:bg-surface-muted hover:text-primary'
            }`}
            data-training-view={v.id}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
