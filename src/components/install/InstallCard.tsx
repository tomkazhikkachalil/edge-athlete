'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { COPY } from '@/lib/copy';
import { useInstallApp } from './InstallAppProvider';

/**
 * The feed's invitation to put Edge Athlete on the home screen — phones and
 * tablets only, signed in, once: dismissed for good by the X, and gone by
 * itself once the app is installed. It never stacks on the Get Started card
 * (a new account has enough to do): globals.css hides it while that card is
 * its previous sibling, so the feed renders the two side by side in the DOM.
 */

const DISMISS_KEY = 'ea:install-card:dismissed:v1';

function readDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export default function InstallCard() {
  const { user } = useAuth();
  const app = useInstallApp();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!user || dismissed || !app.canInvite || !app.handheld) return null;

  return (
    <section
      aria-label={COPY.INSTALL.CARD_TITLE}
      data-install-card=""
      className="mb-4 sm:mb-6 bg-surface rounded-xl shadow-sm border border-border p-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="shrink-0 w-10 h-10 rounded-lg bg-brand-soft text-brand-fg flex items-center justify-center"
        >
          <i className="fas fa-mobile-screen-button"></i>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-primary">{COPY.INSTALL.CARD_TITLE}</h2>
          <p className="text-sm text-secondary mt-0.5">{COPY.INSTALL.CARD_BODY}</p>
          <button
            type="button"
            onClick={app.install}
            data-install-cta=""
            className="ea-cta mt-3 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg text-sm font-semibold text-white"
          >
            <i className="fas fa-download" aria-hidden="true"></i>
            {COPY.INSTALL.CTA}
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.setItem(DISMISS_KEY, '1');
            } catch {
              // Storage unavailable — dismiss for this visit only.
            }
            setDismissed(true);
          }}
          aria-label={COPY.INSTALL.CARD_DISMISS}
          className="ea-icon-btn inline-flex items-center justify-center shrink-0 text-muted hover:text-secondary"
        >
          <i className="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
    </section>
  );
}
