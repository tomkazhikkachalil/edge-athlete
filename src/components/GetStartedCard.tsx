'use client';

/**
 * First-run "Get started" checklist for new accounts — the gap the launch
 * sweep found: a day-one golfer lands on a populated global feed with zero
 * guidance. Four steps derived from real data (no new tables, see
 * /api/profile/getting-started), shown only while the account is young AND
 * steps remain, dismissible, and gone for good once every step is done.
 *
 * Closed stays closed (Oct 2026): the X is stamped on the ACCOUNT through the
 * same route, so the card does not come back on another device, in a private
 * window or in the app installed from the home screen. The browser key is
 * the fast path only. See src/lib/get-started.ts.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { firstActivityCopy } from '@/lib/sports/first-activity-copy';
import { useAuth } from '@/lib/auth';
import { GET_STARTED_DISMISSED_EVENT, LEGACY_DISMISS_KEY, dismissKeyFor, shouldReserveGetStarted } from '@/lib/get-started';

const FOLLOW_TARGET = 3;

interface ChecklistState {
  /** A golf round OR a stat-line post (Round 4); `hasRound` is the pre-Round-4 name. */
  hasActivity?: boolean;
  hasRound: boolean;
  hasAvatar: boolean;
  followingCount: number;
  hasCompetitive: boolean;
}

function safeGetDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(dismissKeyFor(userId)) === '1' || localStorage.getItem(LEGACY_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed(userId: string): void {
  try {
    localStorage.setItem(dismissKeyFor(userId), '1');
  } catch {
    // Storage unavailable — the account's own stamp still holds.
  }
}

/** The house secondary button (globals.css .ea-btn-secondary): a 44px target,
 * one look with "View all rounds" / "Trends" on the profile, no arrow glyph. */
const ACTION_CLASS = 'ea-btn-secondary inline-flex items-center text-sm font-semibold';

export default function GetStartedCard({ onLogRound }: { onLogRound: () => void }) {
  const { user, profile } = useAuth();
  const [state, setState] = useState<ChecklistState | null>(null);
  // Read once, at mount (lazy initialisers — never in render, never in an
  // effect): the clock the age gate uses and whether THIS device closed the
  // card. The feed mounts the card only once the user is known.
  const [now] = useState(() => Date.now());
  const [deviceClosed] = useState(() => (user ? safeGetDismissed(user.id) : false));
  // Closed in this session (the X) or by the account on another device (the
  // API says so) — from then on the card is gone for the visit.
  const [closed, setClosed] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  // The height the resolving card painted at, kept as the floor once the
  // steps API fills the rows in: the card never gets shorter under the feed.
  const [minHeight, setMinHeight] = useState<number | null>(null);

  const createdAtIso = profile?.created_at ?? null;
  const userType = profile?.user_type ?? null;

  // Decided in render from what the client already holds (the account's age,
  // its kind, this device's dismissal), so the FIRST paint includes the card —
  // resolving — instead of waiting for the API's ~2 s (Oct 22 2026, Tom:
  // "reserve its space"; the rule is shouldReserveGetStarted).
  const reserved = !!user && !closed && shouldReserveGetStarted({ createdAt: createdAtIso, userType, browserDismissed: deviceClosed }, now);

  useEffect(() => {
    if (!user || !reserved) return;
    const userId = user.id;
    let cancelled = false;
    fetch('/api/profile/getting-started')
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (cancelled || !body) return;
        // Closed on another device (or before this storage existed): stay
        // closed, and save the next visit the request.
        if (body.dismissed) {
          rememberDismissed(userId);
          setClosed(true);
          return;
        }
        // Keep the resolving card's height as the floor, then fill the rows in
        // the same commit — the box under the feed does not move.
        setMinHeight(sectionRef.current?.offsetHeight ?? null);
        setState(body);
      })
      .catch(() => {
        // A card that can't load keeps its resolving rows — never an error state.
      });
    return () => {
      cancelled = true;
    };
  }, [user, reserved]);

  // Organizers (mig 178) run orgs, not rounds — the checklist is an athlete's
  // (the rule already said no for them; this keeps the type narrow).
  if (!user || !reserved) return null;

  // Resolving: the two steps the profile row already answers (the photo, the
  // follow count — trigger-maintained) are real; the two only the API knows
  // (an activity, a competitive level) show as not done, which is what a new
  // account almost always is — so the usual cold load changes nothing when
  // the answer lands.
  const resolving = state === null;
  const shown: ChecklistState = state ?? {
    hasRound: false,
    hasAvatar: !!profile?.avatar_url,
    followingCount: profile?.following_count ?? 0,
    hasCompetitive: false,
  };

  // Step 1 speaks the athlete's sport (Round 4): a golfer logs a round, a
  // hockey player a game, a runner a race — the composer is the same door.
  const first = firstActivityCopy(profile?.sport);
  const steps = [
    {
      key: 'round',
      done: shown.hasActivity ?? shown.hasRound,
      label: first.label,
      hint: first.hint,
      action: <button type="button" onClick={onLogRound} className={ACTION_CLASS}>{first.cta}</button>,
    },
    {
      key: 'avatar',
      done: shown.hasAvatar,
      label: 'Add a profile photo',
      hint: 'Profiles with faces get followed.',
      action: <Link href="/athlete" className={ACTION_CLASS}>Add photo</Link>,
    },
    {
      key: 'follow',
      done: shown.followingCount >= FOLLOW_TARGET,
      label: `Follow ${FOLLOW_TARGET} athletes${shown.followingCount > 0 && shown.followingCount < FOLLOW_TARGET ? ` (${shown.followingCount}/${FOLLOW_TARGET})` : ''}`,
      hint: 'Your Following feed comes alive.',
      action: <Link href="/sports/explore" className={ACTION_CLASS}>Find athletes</Link>,
    },
    {
      key: 'competitive',
      done: shown.hasCompetitive,
      label: 'Add your competitive level',
      hint: 'Tell coaches where you compete.',
      action: <Link href="/athlete?edit=sport" className={ACTION_CLASS}>Set level</Link>,
    },
  ];

  const remaining = steps.filter(s => !s.done);
  if (!resolving && remaining.length === 0) return null; // all done — gone for good

  const doneCount = steps.length - remaining.length;

  return (
    <section
      ref={sectionRef}
      aria-label="Get started"
      aria-busy={resolving || undefined}
      className="mb-4 sm:mb-6 bg-surface rounded-xl shadow-sm border border-border p-4"
      style={minHeight ? { minHeight } : undefined}
      data-testid="get-started-card"
      data-get-started={resolving ? 'resolving' : 'resolved'}
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
            rememberDismissed(user.id);
            // The account remembers it — every device, not just this browser.
            void fetch('/api/profile/getting-started', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dismiss: true }),
              keepalive: true,
            }).catch(() => {
              // Offline: this browser still remembers; the next close retries.
            });
            // Closing one card must not make another appear in its place.
            window.dispatchEvent(new Event(GET_STARTED_DISMISSED_EVENT));
            setClosed(true);
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
              className={`fas ${step.done ? 'fa-circle-check text-green-600 dark:text-green-400' : 'fa-circle text-decor'} mt-0.5`}
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
