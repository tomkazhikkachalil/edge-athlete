'use client';

import { useAuth } from '@/lib/auth';
import { formatDisplayName } from '@/lib/formatters';
import StickyBanner from '@/components/StickyBanner';

// Persistent acting-as context indicator (guardian-profiles). Renders on
// EVERY screen whenever a guardian is acting as a managed athlete — the
// active context must be obvious at a glance, always. Mounted once in the
// root layout.
export default function ActingAsBanner() {
  const { activeProfile, setActiveProfile } = useAuth();
  if (!activeProfile) return null;

  return (
    <StickyBanner className="bg-amber-100 border-b border-amber-300 px-4 py-2">
      {/* flex-wrap + truncate: a long athlete name wraps the action onto its
          own line instead of pushing the row past a 320px screen. */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
        <i className="fas fa-user-shield text-amber-700 shrink-0"></i>
        <span className="text-amber-900 font-medium min-w-0 truncate">
          {/* "Posting as", not "Acting as": switching affects composing only —
              settings, messages and notifications stay the guardian's own.
              The family console is the management surface. */}
          Posting as {formatDisplayName(activeProfile.first_name, null, activeProfile.last_name)}
        </span>
        <button
          type="button"
          onClick={() => setActiveProfile(null)}
          className="text-amber-800 underline hover:text-amber-950 font-medium min-h-[44px] -my-2.5 inline-flex items-center whitespace-nowrap"
        >
          Switch back to me
        </button>
      </div>
    </StickyBanner>
  );
}
