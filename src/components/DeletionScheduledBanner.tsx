'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { parkPurgeDate } from '@/lib/account-park';

// Soft-delete restore banner (Family Console Wave 1e, migration 128):
// deleting an account PARKS it for 30 days; an owner who signs back in
// during the window sees this on every screen and can cancel the deletion
// with one tap. Mounted once in the root layout beside TransferBanner /
// ActingAsBanner. (Guardians restore parked ATHLETES from the family
// console hub, not here — this banner is for the signed-in owner.)
export default function DeletionScheduledBanner() {
  const { user, profile, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parkedAt = profile?.deletion_requested_at ?? null;
  if (!user || !parkedAt) return null;

  const purgeDate = parkPurgeDate(parkedAt).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  });

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/restore', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not restore the account');
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore the account');
      setBusy(false);
    }
  };

  return (
    <div className="bg-red-600 text-white px-4 py-2 text-sm flex flex-wrap items-center justify-center gap-x-3 gap-y-1" role="alert">
      <span>
        <i className="fas fa-triangle-exclamation mr-2" aria-hidden="true"></i>
        This account is scheduled for deletion on {purgeDate}.
      </span>
      <button
        type="button"
        onClick={restore}
        disabled={busy}
        className="inline-flex min-h-[44px] items-center -my-2 font-bold underline underline-offset-2 hover:text-red-100 active:text-red-100 disabled:opacity-60"
      >
        {busy ? 'Restoring…' : 'Restore account'}
      </button>
      {error && <span className="font-semibold">{error}</span>}
    </div>
  );
}
