'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import {
  clearParkedOrgClaim,
  loadParkedOrgClaim,
  type ParkedOrgClaim,
} from '@/lib/org-claim-parked';

// ── The way back to a parked org claim (phase 1 round 2) ────────────────────
// Rendered by AppHeader on every authed surface, so wherever the sign-up
// detour lands, the banner catches it — no dependency on a ?next= redirect
// the auth flow doesn't have. localStorage is read post-mount (setTimeout 0,
// the hydration dodge); renders null unless a parked claim exists AND the
// user is signed in. No fetches — AppHeader stays light.

export default function ResumeOrgClaimBanner() {
  const { user } = useAuth();
  const [parked, setParked] = useState<ParkedOrgClaim | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setParked(loadParkedOrgClaim()), 0);
    return () => clearTimeout(t);
  }, []);

  if (!user || !parked) return null;

  return (
    <div className="bg-brand-soft border-b border-border px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
      <span className="text-primary">
        Finish claiming <span className="font-semibold">{parked.orgName}</span>?
      </span>
      <Link
        href={`/org-claim/${parked.token}`}
        className="text-brand-fg hover:text-brand-fg-strong font-semibold"
      >
        Continue →
      </Link>
      <button
        type="button"
        onClick={() => {
          clearParkedOrgClaim();
          setParked(null);
        }}
        aria-label="Dismiss claim reminder"
        className="text-muted hover:text-secondary"
      >
        <i className="fas fa-times text-xs" aria-hidden="true"></i>
      </button>
    </div>
  );
}
