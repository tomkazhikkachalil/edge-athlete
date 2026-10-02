'use client';

import { COPY } from '@/lib/copy';
import { useInstallApp } from './InstallAppProvider';

/** The quiet door on the sign-in page: one line, gone once installed. */
export default function InstallLink({ className = '' }: { className?: string }) {
  const app = useInstallApp();
  if (!app.canInvite) return null;
  return (
    <div className={className}>
      <button
        type="button"
        onClick={app.install}
        data-install-link=""
        className="inline-flex items-center gap-2 min-h-[44px] text-sm font-medium text-brand-fg hover:text-brand-fg-strong"
      >
        <i className="fas fa-mobile-screen-button" aria-hidden="true"></i>
        {COPY.INSTALL.CTA}
      </button>
    </div>
  );
}
