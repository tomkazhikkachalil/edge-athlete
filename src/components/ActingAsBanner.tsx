'use client';

import { useAuth } from '@/lib/auth';
import { formatDisplayName } from '@/lib/formatters';

// Persistent acting-as context indicator (guardian-profiles). Renders on
// EVERY screen whenever a guardian is acting as a managed athlete — the
// active context must be obvious at a glance, always. Mounted once in the
// root layout.
export default function ActingAsBanner() {
  const { activeProfile, setActiveProfile } = useAuth();
  if (!activeProfile) return null;

  return (
    <div className="sticky top-0 z-[60] w-full bg-amber-100 border-b border-amber-300 px-4 py-2 flex items-center justify-center gap-3 text-sm safe-x">
      <i className="fas fa-user-shield text-amber-700"></i>
      <span className="text-amber-900 font-medium">
        Acting as {formatDisplayName(activeProfile.first_name, null, activeProfile.last_name)}
      </span>
      <button
        type="button"
        onClick={() => setActiveProfile(null)}
        className="text-amber-800 underline hover:text-amber-950 font-medium"
      >
        Switch back to me
      </button>
    </div>
  );
}
