'use client';

import { useState } from 'react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import { COPY } from '@/lib/copy';
import type { InstallMode } from '@/lib/install/platform';

/**
 * The guide "Download the app" opens when the browser cannot install in one
 * tap — which is every iPhone (Apple gives a website no install API). The
 * steps are the device's own, chosen by installMode; this only draws them.
 * Fetched on first open (InstallAppProvider), never on page load.
 */

interface Props {
  mode: InstallMode;
  onClose: () => void;
  onInstall: () => void;
}

/** The step's glyph: what the person is looking for on their own screen. */
const STEP_ICONS: Partial<Record<InstallMode, readonly string[]>> = {
  'ios-safari': ['fa-arrow-up-from-bracket', 'fa-square-plus', 'fa-check'],
  'ios-browser': ['fa-arrow-up-from-bracket', 'fa-square-plus', 'fa-check'],
  'android-menu': ['fa-ellipsis-vertical', 'fa-mobile-screen-button', 'fa-check'],
  'ios-in-app': ['fa-compass', 'fa-right-to-bracket', 'fa-mobile-screen-button'],
  'android-in-app': ['fa-compass', 'fa-right-to-bracket', 'fa-mobile-screen-button'],
};

function stepsFor(mode: InstallMode, host: string): readonly string[] {
  switch (mode) {
    case 'ios-safari':
      return COPY.INSTALL.IOS_SAFARI_STEPS;
    case 'ios-browser':
      return COPY.INSTALL.IOS_BROWSER_STEPS;
    case 'android-menu':
      return COPY.INSTALL.ANDROID_MENU_STEPS;
    case 'ios-in-app':
      return COPY.INSTALL.IN_APP_STEPS('Safari', host);
    case 'android-in-app':
      return COPY.INSTALL.IN_APP_STEPS('Chrome', host);
    default:
      return [];
  }
}

export default function InstallAppSheet({ mode, onClose, onInstall }: Props) {
  // Client-only (the provider loads it with ssr: false, after a tap).
  const [host] = useState(() => window.location.host);
  const [copied, setCopied] = useState(false);
  const steps = stepsFor(mode, host);
  const icons = STEP_ICONS[mode] ?? [];
  const inApp = mode === 'ios-in-app' || mode === 'android-in-app';

  const copyLink = async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(window.location.origin);
        setCopied(true);
      }
    } catch {
      // Clipboard refused — the address is printed in the steps.
    }
  };

  return (
    <LargerWindow
      title={COPY.INSTALL.SHEET_TITLE}
      subtitle={COPY.INSTALL.SHEET_SUBTITLE}
      onClose={onClose}
      windowKey="install-app"
    >
      <div className="space-y-6" data-install-guide={mode}>
        {mode === 'installed' && <p className="text-base text-primary">{COPY.INSTALL.USING_APP}</p>}

        {mode === 'prompt' && (
          <div className="space-y-4">
            <p className="text-base text-primary">{COPY.INSTALL.PROMPT_BODY}</p>
            <button
              type="button"
              onClick={() => {
                onClose();
                onInstall();
              }}
              data-install-now=""
              className="ea-cta w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg text-sm font-semibold text-white"
            >
              <i className="fas fa-download" aria-hidden="true"></i>
              {COPY.INSTALL.PROMPT_BUTTON}
            </button>
          </div>
        )}

        {mode === 'desktop' && <p className="text-base text-primary">{COPY.INSTALL.DESKTOP_BODY(host)}</p>}

        {inApp && <p className="text-base text-primary">{COPY.INSTALL.IN_APP_BODY}</p>}

        {steps.length > 0 && (
          <ol className="space-y-4">
            {steps.map((step, i) => (
              <li key={step} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="shrink-0 w-10 h-10 rounded-full bg-brand-soft text-brand-fg flex items-center justify-center"
                >
                  <i className={`fas ${icons[i] ?? 'fa-circle'}`}></i>
                </span>
                <p className="text-base text-primary pt-2 min-w-0">
                  <span className="font-bold">{i + 1}.</span> {step}
                </p>
              </li>
            ))}
          </ol>
        )}

        {mode === 'ios-browser' && <p className="text-sm text-secondary">{COPY.INSTALL.IOS_BROWSER_NOTE(host)}</p>}

        {inApp && (
          <button
            type="button"
            onClick={() => void copyLink()}
            className="ea-interactive inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg border border-border-strong text-sm font-semibold text-secondary"
          >
            <i className={`fas ${copied ? 'fa-check' : 'fa-link'}`} aria-hidden="true"></i>
            <span aria-live="polite">{copied ? COPY.INSTALL.LINK_COPIED : COPY.INSTALL.COPY_LINK}</span>
          </button>
        )}

        {mode !== 'installed' && (
          <p className="text-sm text-secondary border-t border-border-subtle pt-4">
            {COPY.INSTALL.SAME_APP} {COPY.INSTALL.SIGN_IN_ONCE}
          </p>
        )}
      </div>
    </LargerWindow>
  );
}
