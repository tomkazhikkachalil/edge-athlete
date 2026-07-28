'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { FEATURE_FLAGS } from '@/lib/features';
import { bannerCopy, type ClientTransfer } from '@/lib/transfer-ui';

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

  useEffect(() => {
    if (!eligible) { setTransfer(null); return; }
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
    <div className="sticky top-0 z-[60] w-full bg-violet-100 border-b border-violet-300 px-4 py-2 flex items-center justify-center gap-3 text-sm safe-x">
      <i className="fas fa-key text-violet-700"></i>
      <span className="text-violet-900 font-medium">{bannerCopy(transfer.state)}</span>
      <Link href={`/app/transfer/${user!.id}`} className="text-violet-800 underline hover:text-violet-950 font-medium">
        See details
      </Link>
    </div>
  );
}
