'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { clearParkedOrgInvite, loadParkedOrgInvite, type ParkedOrgInvite } from '@/lib/org-invite-parked';

// ── The way back to a parked staff invite (org staff program, 178) ──────────
// ResumeOrgClaimBanner's twin: rendered by AppHeader on every authed
// surface; localStorage read post-mount (the hydration dodge); null unless
// a parked invite exists AND the user is signed in. No fetches.

export default function ResumeOrgInviteBanner() {
  const { user } = useAuth();
  const [parked, setParked] = useState<ParkedOrgInvite | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setParked(loadParkedOrgInvite()), 0);
    return () => clearTimeout(t);
  }, []);

  if (!user || !parked) return null;

  return (
    <div className="bg-brand-soft border-b border-border px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
      <span className="text-primary">
        Accept your invite to help run <span className="font-semibold">{parked.orgName}</span>?
      </span>
      <Link href={`/org-invite/${parked.token}`} className="text-brand-fg hover:text-brand-fg-strong font-semibold">
        Continue →
      </Link>
      <button
        type="button"
        onClick={() => {
          clearParkedOrgInvite();
          setParked(null);
        }}
        aria-label="Dismiss invite reminder"
        className="text-muted hover:text-secondary"
      >
        <i className="fas fa-times text-xs" aria-hidden="true"></i>
      </button>
    </div>
  );
}
