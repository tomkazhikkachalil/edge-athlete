'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { GET_STARTED_DISMISSED_EVENT } from '@/lib/get-started';
import { useInstallApp } from '@/components/install/InstallAppProvider';
import { usePhoneNotifications } from './usePhoneNotifications';

/**
 * The feed's one invitation to turn phone notifications on (mig 248) — only
 * in the app opened from the home-screen icon, only while this device can
 * ask (or is allowed but not yet on), and once: the X dismisses it for good on THIS device (notifications
 * are per device, so is the question). It is the install card's successor —
 * that card shows only before the app is installed, this one only after — so
 * the two never meet; and like it, it waits while the Get Started card shows
 * (globals.css) and never slides into that card's slot the moment it closes.
 */

const DISMISS_KEY = 'ea:push-card:dismissed:v1';

function readDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export default function PushCard() {
  const { user } = useAuth();
  const { mode } = useInstallApp();
  const { showError } = useToast();
  const phone = usePhoneNotifications();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const wait = () => setWaiting(true);
    window.addEventListener(GET_STARTED_DISMISSED_EVENT, wait);
    return () => window.removeEventListener(GET_STARTED_DISMISSED_EVENT, wait);
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Storage unavailable — dismiss for this visit only.
    }
    setDismissed(true);
  };

  if (!user || dismissed || waiting || mode !== 'installed') return null;
  // 'granted' without a subscription is a device that allowed notifications
  // but is not turned on here (turned off, or allowed before this round):
  // the tap then subscribes without a prompt.
  if (!phone.ready || !phone.offered || phone.on) return null;
  if (phone.support !== 'available' && phone.support !== 'granted') return null;

  const turnOn = async () => {
    const result = await phone.turnOn();
    if (result === 'on') return; // the card leaves by itself (phone.on)
    if (result === 'denied') {
      dismiss();
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
          <button
            type="button"
            onClick={turnOn}
            disabled={phone.busy}
            data-push-cta=""
            className="ea-cta mt-3 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
          >
            <i className="fas fa-bell" aria-hidden="true"></i>
            Turn on notifications
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss the notifications invitation"
          className="ea-icon-btn inline-flex items-center justify-center shrink-0 text-muted hover:text-secondary"
        >
          <i className="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
    </section>
  );
}
