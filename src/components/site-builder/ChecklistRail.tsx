'use client';

import type { ChecklistStep } from '@/lib/orgs/checklist';
import { remainingSteps } from '@/lib/site-builder/checklist';

/**
 * The checklist rail — Site Builder P8-B (Sep 9 2026). One strip above the
 * canvas: the six steps as chips, done ones ticked, each open one a button
 * that does what its `href` names (the editor resolves `#theme`, `#picker`,
 * `#publish` and `#w=<id>`). Gone once every required step is done —
 * nothing to dismiss, nothing stored: it is derived, so it comes back the
 * moment a step is undone.
 */
export default function ChecklistRail({ steps, onStep }: { steps: ChecklistStep[]; onStep: (step: ChecklistStep) => void }) {
  const remaining = remainingSteps(steps);
  if (remaining.length === 0) return null;
  const done = steps.filter(s => s.done).length;
  return (
    <nav
      aria-label="Site checklist"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
      data-sb-checklist=""
      data-sb-checklist-done={done}
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-tertiary">
        Get your site ready · {done}/{steps.length}
      </span>
      {steps.map(step => (
        <button
          key={step.key}
          type="button"
          onClick={() => onStep(step)}
          disabled={step.done || !step.href}
          title={step.hint}
          data-sb-checklist-step={step.key}
          data-done={step.done ? '1' : '0'}
          className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
            step.done
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 line-through'
              : 'border-border-strong text-secondary hover:bg-surface-sunken'
          } disabled:cursor-default`}
        >
          <span aria-hidden="true">{step.done ? '✓' : '○'}</span>
          {step.label}
          {step.optional && !step.done && <span className="text-tertiary">(optional)</span>}
        </button>
      ))}
    </nav>
  );
}
