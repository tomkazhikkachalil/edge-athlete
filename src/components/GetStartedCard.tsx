'use client';

/**
 * First-run "Get started" checklist for new accounts — the gap the launch
 * sweep found: a day-one golfer lands on a populated global feed with zero
 * guidance. Four steps derived from real data (no new tables, see
 * /api/profile/getting-started), shown only while the account is young AND
 * steps remain, dismissible (localStorage), and gone for good once every
 * step is done.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

/** Accounts older than this never see the card, even with unmet steps. */
const NEW_ACCOUNT_WINDOW_DAYS = 14;
const DISMISS_KEY = 'ea:get-started:dismissed:v1';
const FOLLOW_TARGET = 3;

interface ChecklistState {
  hasRound: boolean;
  hasAvatar: boolean;
  followingCount: number;
  hasCompetitive: boolean;
}

function safeGetDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Bare-text-link touch recipe from globals.css — 44px effective target, and
 * active: paired with hover: because hover is invisible on touch. */
const ACTION_CLASS =
  'inline-flex min-h-[44px] items-center -my-2 text-brand-fg hover:text-brand-fg-strong active:text-brand-fg-strong font-semibold';

export default function GetStartedCard({ onLogRound }: { onLogRound: () => void }) {
  const { user, profile } = useAuth();
  const [state, setState] = useState<ChecklistState | null>(null);
  const [dismissed, setDismissed] = useState(true); // start hidden; reveal after checks

  const createdAtIso = profile?.created_at ?? null;

  useEffect(() => {
    if (!user || !createdAtIso) return;
    // Age gate lives HERE (Date.now is impure for render, fine in effects).
    const age = Date.now() - new Date(createdAtIso).getTime();
    if (age >= NEW_ACCOUNT_WINDOW_DAYS * 86_400_000) return;
    if (safeGetDismissed()) return;
    let cancelled = false;
    fetch('/api/profile/getting-started')
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (cancelled || !body) return;
        setState(body);
        setDismissed(false);
      })
      .catch(() => {
        // A card that can't load renders nothing — never an error state.
      });
    return () => {
      cancelled = true;
    };
  }, [user, createdAtIso]);

  if (!user || dismissed || !state) return null;

  const steps = [
    {
      key: 'round',
      done: state.hasRound,
      label: 'Log your first round',
      hint: 'Pick the course from search and your handicap starts immediately.',
      action: <button type="button" onClick={onLogRound} className={ACTION_CLASS}>Log a round →</button>,
    },
    {
      key: 'avatar',
      done: state.hasAvatar,
      label: 'Add a profile photo',
      hint: 'Profiles with faces get followed.',
      action: <Link href="/athlete" className={ACTION_CLASS}>Add photo →</Link>,
    },
    {
      key: 'follow',
      done: state.followingCount >= FOLLOW_TARGET,
      label: `Follow ${FOLLOW_TARGET} athletes${state.followingCount > 0 && state.followingCount < FOLLOW_TARGET ? ` (${state.followingCount}/${FOLLOW_TARGET})` : ''}`,
      hint: 'Your Following feed comes alive.',
      action: <Link href="/explore" className={ACTION_CLASS}>Find athletes →</Link>,
    },
    {
      key: 'competitive',
      done: state.hasCompetitive,
      label: 'Add your competitive level',
      hint: 'Tell coaches where you compete.',
      action: <Link href="/athlete?edit=sport" className={ACTION_CLASS}>Set level →</Link>,
    },
  ];

  const remaining = steps.filter(s => !s.done);
  if (remaining.length === 0) return null; // all done — gone for good

  const doneCount = steps.length - remaining.length;

  return (
    <section
      aria-label="Get started"
      className="mb-4 sm:mb-6 bg-surface rounded-xl shadow-sm border border-border p-4"
      data-testid="get-started-card"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="font-bold text-primary">Get started on Edge Athlete</h2>
          <p className="text-xs text-muted mt-0.5">
            {doneCount} of {steps.length} done — finish these and your profile tells your story.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, '1');
            } catch {
              // Storage unavailable — dismiss for this visit only.
            }
            setDismissed(true);
          }}
          aria-label="Dismiss get started checklist"
          className="ea-icon-btn inline-flex items-center justify-center shrink-0 text-muted hover:text-secondary"
        >
          <i className="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>

      <ul className="space-y-2.5">
        {steps.map(step => (
          <li key={step.key} className="flex items-start gap-3">
            <i
              className={`fas ${step.done ? 'fa-circle-check text-green-600 dark:text-green-400' : 'fa-circle text-faint'} mt-0.5`}
              aria-hidden="true"
            ></i>
            <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-3">
              <div className="min-w-0 sm:flex-1">
                <span className={`text-sm font-medium ${step.done ? 'text-muted line-through' : 'text-primary'}`}>
                  {step.label}
                </span>
                {!step.done && <p className="text-xs text-muted">{step.hint}</p>}
              </div>
              {/* CTA drops below the text on phones — beside it the label had
                  ~160px at 375px and wrapped raggedly. */}
              {!step.done && <span className="text-sm sm:shrink-0">{step.action}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
