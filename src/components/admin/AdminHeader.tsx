'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ADMIN_LOGIN_PATH } from '@/lib/admin/session';

/** The console's own header (flow changes item 2): who is signed in, Sign out, the way back to the app. */
export default function AdminHeader({ email, role }: { email: string; role: 'owner' | 'moderator' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await fetch('/api/admin/session', { method: 'DELETE' });
    } finally {
      router.replace(ADMIN_LOGIN_PATH);
      router.refresh();
    }
  };
  return (
    <header className="border-b border-border bg-surface" data-admin-header>
      <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <Link href="/admin" className="text-base font-bold text-primary">
          <i className="fas fa-shield-alt mr-2 text-brand-fg" aria-hidden="true"></i>
          Edge Athlete admin
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden sm:inline text-muted" data-admin-who={role}>{email} · {role}</span>
          <Link href="/feed" className="text-brand-fg underline">Open the app</Link>
          <button type="button" onClick={signOut} disabled={busy} className="ea-interactive rounded-lg border border-border px-3 py-2 min-h-[44px] font-semibold text-primary disabled:opacity-50" data-admin-signout="">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
