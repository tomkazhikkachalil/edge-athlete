'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { GET_STARTED_DISMISSED_EVENT } from '@/lib/get-started';
import { useInstallApp } from '@/components/install/InstallAppProvider';
import { cardDecision, isSnoozed, parseSnooze, PUSH_CARD_SNOOZE_KEY, snoozeUntil } from '@/lib/push/card';
import { usePhoneNotifications } from './usePhoneNotifications';

/**
 * The feed's invitation to turn phone notifications on (mig 248) — only in
 * the app opened from the home-screen icon, only while this device can ask
 * (or is allowed but not yet on).
 *
 * Tom (Oct 2 2026, "option 1"): it STAYS until the person chooses. "Turn on"
 * ends it; "Not now" (the button and the X alike) puts it away for a week on
 * THIS device, then it asks again. Blocked in the phone's settings → never
 * asked; the Settings row says where to undo it.
 *
 * Oct 4 2026: it asks ONCE per device per account. The choice is remembered
 * on the device (either answer hides the card for good — Settings is the
 * door), and a device that said yes and lost its subscription is repaired
 * silently before this reads it. The whole rule is `cardDecision`
 * (src/lib/push/card.ts), pure and unit-tested.
 *
 * It is the install card's successor — that card shows only before the app
 * is installed, this one only after — so the two never meet; and like it, it
 * waits while the Get Started card shows (globals.css) and never slides into
 * that card's slot the moment it closes.
 */

function readSnoozedUntil(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseSnooze(window.localStorage.getItem(PUSH_CARD_SNOOZE_KEY));
  } catch {
    return null;
  }
}

export default function PushCard() {
  const { user } = useAuth();
  const { mode } = useInstallApp();
  const { showError } = useToast();
  const phone = usePhoneNotifications();
  // Read once per mount: a week later, the next visit asks again.
  const [snoozedUntil, setSnoozedUntil] = useState(readSnoozedUntil);
  const [now] = useState(() => Date.now());
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const wait = () => setWaiting(true);
    window.addEventListener(GET_STARTED_DISMISSED_EVENT, wait);
    return () => window.removeEventListener(GET_STARTED_DISMISSED_EVENT, wait);
  }, []);

  const notNow = () => {
    const until = snoozeUntil(Date.now());
    try {
      window.localStorage.setItem(PUSH_CARD_SNOOZE_KEY, until);
    } catch {
      // Storage unavailable — put away for this visit only.
    }
    setSnoozedUntil(Date.parse(until));
  };

  const show = cardDecision({
    signedIn: !!user,
    installed: mode === 'installed',
    waiting,
    snoozed: isSnoozed(snoozedUntil, now),
    choice: phone.choice,
    ready: phone.ready,
    offered: phone.offered,
    on: phone.on,
    support: phone.support,
  });
  if (!show) return null;

  const turnOn = async () => {
    const result = await phone.turnOn();
    if (result === 'on') return; // the card leaves by itself (the choice is recorded)
    if (result === 'denied') {
      // Blocked: the card leaves by itself (the device can no longer be asked).
      showError('Notifications are blocked', 'You can allow them later in your phone’s settings.');
    } else {
      showError('Could not turn on notifications', 'Please try again in a moment.');
    }
  };

  return (
    <section
      aria-label="Turn on notifications"
      data-push-card=""
      className="mb-4 sm:mb-6 bg-surface rounded-xl shadow-sm border border-border p-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="shrink-0 w-10 h-10 rounded-lg bg-brand-soft text-brand-fg flex items-center justify-center"
        >
          <i className="fas fa-bell"></i>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-primary">Know when something happens</h2>
          <p className="text-sm text-secondary mt-0.5">
            Get a notification for new messages and activity, with a number on the app icon. Tap one to go straight to it.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={turnOn}
              disabled={phone.busy}
              data-push-cta=""
              className="ea-cta inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
            >
              <i className="fas fa-bell" aria-hidden="true"></i>
              Turn on notifications
            </button>
            <button
              type="button"
              onClick={notNow}
              data-push-not-now=""
              className="ea-interactive inline-flex items-center min-h-[44px] px-4 rounded-lg text-sm font-medium text-secondary"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={notNow}
          aria-label="Not now — ask me again in a week"
          className="ea-icon-btn inline-flex items-center justify-center shrink-0 text-muted hover:text-secondary"
        >
          <i className="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
    </section>
  );
}
