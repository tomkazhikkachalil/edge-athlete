'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminAuth } from '@/lib/admin/use-admin-auth';
import AdminHeader from '@/components/admin/AdminHeader';
import ContactsPanel from '@/components/admin/ContactsPanel';
import NotifyInboxCard from '@/components/admin/NotifyInboxCard';
import { backOr } from '@/lib/nav-back';

// The contact list page (266, flow changes item 1): the inbox setting on
// top, the list under it. Authorization lives in the API (requireAdmin —
// owner); a 401 / 403 renders the forbidden state, like the other console
// pages. Moves to /admin with the console (program B).

export default function ContactsAdminPage() {
  const { user, loading } = useAdminAuth();
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');

  useEffect(() => {
    if (!loading && !user) router.replace('/admin/login');
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/me', { cache: 'no-store' });
        const body = res.ok ? ((await res.json().catch(() => null)) as { admin?: boolean } | null) : null;
        if (!cancelled) setState(body?.admin === true ? 'ready' : 'forbidden');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading, router]);

  return (
    <div className="min-h-screen bg-canvas">
      <AdminHeader />
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => backOr(router, '/admin')} className="ea-icon-btn" aria-label="Back">
            <i className="fas fa-arrow-left" aria-hidden="true"></i>
          </button>
          <h1 className="text-2xl font-bold text-primary">Contacts</h1>
        </div>
        {state === 'loading' && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
          </div>
        )}
        {state === 'forbidden' && (
          <div className="text-center px-4 py-20">
            <i className="fas fa-lock text-4xl text-decor mb-4" aria-hidden="true"></i>
            <h2 className="text-xl font-bold text-primary mb-2">Admin access required</h2>
            <p className="text-sm text-tertiary">This area is for Edge Athlete administrators.</p>
          </div>
        )}
        {state === 'error' && <p className="text-sm text-danger-fg">Could not check access. Try again.</p>}
        {state === 'ready' && (
          <>
            <NotifyInboxCard />
            <ContactsPanel />
          </>
        )}
      </div>
    </div>
  );
}
