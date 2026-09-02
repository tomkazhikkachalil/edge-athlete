'use client';

import { useEffect, useState } from 'react';

// ── Org setup checklist (phase 1) — the GetStartedCard recipe ───────────────
// The step logic is the PURE module (src/lib/orgs/checklist.ts — C5 added
// the golf variant + anchors); this component only renders and dismisses.
// Dismissible per org via localStorage; gone for good once every required
// step is done.

import {
  buildOrgChecklistSteps,
  remainingSteps,
  type ChecklistVariant,
  type OrgChecklistInput,
} from '@/lib/orgs/checklist';

export { buildOrgChecklistSteps };
export type { OrgChecklistInput };

export default function OrgSetupChecklist({
  storageKey,
  input,
  variant = 'default',
}: {
  /** Per-org dismiss key, e.g. `org-checklist:league:<id>`. */
  storageKey: string;
  input: OrgChecklistInput;
  /** C5: 'golf' for a golf org (the site-builder checklist). */
  variant?: ChecklistVariant;
}) {
  const [dismissed, setDismissed] = useState(true); // render nothing pre-hydration
  useEffect(() => {
    // setTimeout(…, 0) so the reveal is async (the RegistrationSteps
    // rehydration recipe): a lazy initializer would hydration-mismatch and
    // a synchronous effect setState trips the cascading-render lint.
    const t = setTimeout(() => {
      try {
        setDismissed(localStorage.getItem(storageKey) === '1');
      } catch {
        setDismissed(false);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [storageKey]);

  const steps = buildOrgChecklistSteps(input, variant);
  const remaining = remainingSteps(steps);
  if (dismissed || remaining.length === 0) return null;

  return (
    <section
      aria-label="Get set up"
      className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-tertiary">
          Get set up · {steps.length - remaining.length}/{steps.length}
        </h2>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(storageKey, '1');
            } catch {
              /* conveniences may fail */
            }
            setDismissed(true);
          }}
          className="text-xs text-muted hover:text-secondary transition-colors"
        >
          Dismiss
        </button>
      </div>
      <ul className="space-y-2">
        {steps.map(step => (
          <li key={step.key} className="flex items-start gap-2">
            <i
              className={`fas ${step.done ? 'fa-circle-check text-emerald-600' : 'fa-circle text-faint'} mt-0.5 text-sm`}
              aria-hidden="true"
            ></i>
            <div className="min-w-0">
              <p className={`text-sm font-medium ${step.done ? 'text-tertiary line-through' : 'text-primary'}`}>
                {step.href && !step.done ? (
                  <a href={step.href} className="hover:text-brand-fg">
                    {step.label}
                  </a>
                ) : (
                  step.label
                )}
              </p>
              {!step.done && <p className="text-xs text-muted">{step.hint}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
