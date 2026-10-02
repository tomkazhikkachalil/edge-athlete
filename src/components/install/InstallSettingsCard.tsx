'use client';

import { COPY } from '@/lib/copy';
import { useInstallApp } from './InstallAppProvider';

/**
 * Settings → Account: the door that is always there (the feed card can be
 * dismissed; this cannot). Says which of three states the device is in —
 * running from the icon, installed but open in a browser tab, or not yet.
 */
export default function InstallSettingsCard() {
  const app = useInstallApp();
  if (app.mode === null) return null;

  const usingApp = app.mode === 'installed';

  return (
    <div data-install-settings={usingApp ? 'using' : app.knownInstalled ? 'installed' : 'invite'}>
      <div className="mb-4">
        <h3 className="text-2xl font-bold text-primary tracking-tight">{COPY.INSTALL.SETTINGS_TITLE}</h3>
      </div>
      <div className="bg-surface rounded-xl p-6 sm:p-8 border border-border shadow-sm">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="shrink-0 w-10 h-10 bg-violet-100 dark:bg-violet-950/60 rounded-lg flex items-center justify-center"
          >
            <i className={`fas ${usingApp ? 'fa-circle-check' : 'fa-mobile-screen-button'} text-brand-fg text-lg`}></i>
          </span>
          <div className="min-w-0">
            {usingApp ? (
              <p className="text-base font-medium text-primary pt-2">{COPY.INSTALL.USING_APP}</p>
            ) : app.knownInstalled ? (
              <>
                <p className="text-base font-medium text-primary">{COPY.INSTALL.INSTALLED_HERE}</p>
                <button
                  type="button"
                  onClick={app.openGuide}
                  className="mt-2 inline-flex items-center min-h-[44px] -my-2 text-sm font-semibold text-brand-fg hover:text-brand-fg-strong"
                >
                  {COPY.INSTALL.SHOW_STEPS}
                </button>
              </>
            ) : (
              <>
                <p className="text-base text-primary">{COPY.INSTALL.SETTINGS_BODY}</p>
                <button
                  type="button"
                  onClick={app.install}
                  data-install-cta=""
                  className="ea-cta mt-4 inline-flex items-center gap-2 min-h-[44px] px-5 rounded-lg text-sm font-semibold text-white"
                >
                  <i className="fas fa-download" aria-hidden="true"></i>
                  {COPY.INSTALL.CTA}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
