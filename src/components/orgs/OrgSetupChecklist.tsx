'use client';

import { useEffect, useState } from 'react';

// ── Org setup checklist (phase 1) — the GetStartedCard recipe ───────────────
// Every `done` is DERIVED from rows the console already fetched (no
// checklist table, no fetch of its own — the masterplan's "a checklist,
// not a blank page"). Dismissible per org via localStorage; gone for good
// once every step is done.

export interface OrgChecklistInput {
  hasSeasonWithDates: boolean;
  hasDivisions: boolean;
  hasTeams: boolean;
  managerCount: number;
  rosterAthleteCount: number;
}

interface Step {
  key: string;
  done: boolean;
  label: string;
  hint: string;
}

export function buildOrgChecklistSteps(input: OrgChecklistInput): Step[] {
  return [
    {
      key: 'season',
      done: input.hasSeasonWithDates,
      label: 'Create a season with dates',
      hint: 'Everything else hangs off a season — “2026-27” with a start and end.',
    },
    {
      key: 'divisions',
      done: input.hasDivisions,
      label: 'Add your divisions',
      hint: 'Age band × stream × tier — the shape your programs actually run.',
    },
    {
      key: 'teams',
      done: input.hasTeams,
      label: 'Add teams and enter them',
      hint: 'Teams persist across seasons; enter them into this season’s divisions.',
    },
    {
      key: 'managers',
      done: input.managerCount >= 2,
      label: 'Invite a co-manager',
      hint: 'Promote a member from the members list on your public page.',
    },
    {
      key: 'roster',
      done: input.rosterAthleteCount > 0,
      label: 'Roster your first athlete',
      hint: 'Invite a member to the roster — the record edge stats attach to.',
    },
  ];
}

export default function OrgSetupChecklist({
  storageKey,
  input,
}: {
  /** Per-org dismiss key, e.g. `org-checklist:league:<id>`. */
  storageKey: string;
  input: OrgChecklistInput;
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

  const steps = buildOrgChecklistSteps(input);
  const remaining = steps.filter(s => !s.done);
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
                {step.label}
              </p>
              {!step.done && <p className="text-xs text-muted">{step.hint}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
