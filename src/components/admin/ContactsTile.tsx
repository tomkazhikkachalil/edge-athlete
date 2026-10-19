'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContactsPage } from '@/lib/contacts/admin-server';

/**
 * The console's door to the contact list (266): the counts from
 * /api/admin/contacts. The tile renders while the counts load or fail so
 * the door never disappears; pre-266 the API answers supported:false.
 */
export default function ContactsTile() {
  const router = useRouter();
  const [page, setPage] = useState<ContactsPage | null | 'error'>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/contacts?page=1', { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setPage('error'); return; }
        const data = (await res.json()) as ContactsPage;
        if (!cancelled) setPage(data);
      } catch {
        if (!cancelled) setPage('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const counts = page && page !== 'error' && page.supported ? page.counts : null;
  return (
    <button
      type="button"
      onClick={() => router.push('/admin/contacts')}
      className="bg-surface rounded-lg shadow-sm border border-border p-4 text-left hover:border-violet-300 transition"
      data-contacts-tile=""
    >
      <p className="text-sm font-semibold text-primary">
        <i className="fas fa-address-book text-brand-fg mr-2" aria-hidden="true"></i>
        Contacts
      </p>
      <p className="text-xs text-muted mt-1">
        {page === null && 'Sign-ups and inquiries.'}
        {page === 'error' && 'Sign-ups and inquiries — counts unavailable.'}
        {page !== null && page !== 'error' && !page.supported && 'Not available yet — run migration 266.'}
        {counts && `${counts.all} total · ${counts.signups} sign-ups · ${counts.inquiries} inquiries · ${counts.consented} agreed to marketing`}
      </p>
    </button>
  );
}
