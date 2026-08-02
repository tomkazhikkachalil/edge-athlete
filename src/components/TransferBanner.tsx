'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { FEATURE_FLAGS } from '@/lib/features';
import { bannerCopy, type ClientTransfer } from '@/lib/transfer-ui';
import StickyBanner from '@/components/StickyBanner';

// Supervised-athlete banner (guardian-profiles): when an account handover is
// in flight for the signed-in supervised athlete, surface it on every screen
// with a link to the transfer page. Mounted once in the root layout, next to
// ActingAsBanner (mutually exclusive audiences: that one is for guardians).
export default function TransferBanner() {
  const { user, profile } = useAuth();
  const pathname = usePathname();
  const [transfer, setTransfer] = useState<ClientTransfer | null>(null);

  const eligible =
    FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES &&
    !!user &&
    profile?.supervision_state === 'supervised';

  // Clearing on ineligible is state synchronisation; do it during render so
  // a stale banner never paints. The fetch below stays a real side effect.
  const [syncedEligible, setSyncedEligible] = useState(eligible);
  if (syncedEligible !== eligible) {
    setSyncedEligible(eligible);
    if (!eligible) setTransfer(null);
  }

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/transfers?profileId=${user!.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setTransfer(data.transfer ?? null);
      } catch {
        // Banner is best-effort; the transfer page is the real surface.
      }
    })();
    return () => { cancelled = true; };
  }, [eligible, user]);

  if (!eligible || !transfer || pathname?.startsWith('/app/transfer')) return null;

  return (
    <StickyBanner className="bg-violet-100 border-b border-violet-300 px-4 py-2">
      {/* flex-wrap + truncate: long transfer copy wraps the action onto its
          own line instead of pushing the row past a 320px screen. */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
        <i className="fas fa-key text-violet-700 shrink-0"></i>
        <span className="text-violet-900 font-medium min-w-0 truncate">{bannerCopy(transfer.state)}</span>
        <Link
          href={`/app/transfer/${user!.id}`}
          className="text-violet-800 underline hover:text-violet-950 font-medium min-h-[44px] -my-2.5 inline-flex items-center whitespace-nowrap"
        >
          See details
        </Link>
      </div>
    </StickyBanner>
  );
}
