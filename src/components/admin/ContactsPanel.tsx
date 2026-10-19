'use client';

import { useEffect, useState } from 'react';
import type { ContactsPage } from '@/lib/contacts/admin-server';
import type { ContactRow, ContactSource } from '@/lib/contacts/rules';
import { formatDate } from '@/lib/formatters';

/**
 * The contact list (266): one row per sign-up or inquiry, newest first,
 * filtered by source, consent and a name / address search, 50 a page; a
 * tap opens the whole message; Export CSV (every submission) and Export
 * marketing list (the consented addresses, one per email) are plain links
 * to the export route so the browser saves the file.
 */
type Consent = '' | '1' | '0';

export default function ContactsPanel() {
  const [source, setSource] = useState<'' | ContactSource>('');
  const [consent, setConsent] = useState<Consent>('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ContactsPage | 'error' | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page) });
    if (source) params.set('source', source);
    if (consent) params.set('consent', consent);
    if (debouncedQ) params.set('q', debouncedQ);
    (async () => {
      try {
        const res = await fetch(`/api/admin/contacts?${params.toString()}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) { setData('error'); return; }
        setData((await res.json()) as ContactsPage);
      } catch {
        if (!cancelled) setData('error');
      }
    })();
    return () => { cancelled = true; };
  }, [source, consent, debouncedQ, page]);

  const rows: ContactRow[] = data && data !== 'error' ? data.rows : [];
  const total = data && data !== 'error' ? data.total : 0;
  const pageSize = data && data !== 'error' ? data.pageSize : 50;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" aria-label="Contacts" data-contacts-panel="">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-primary">Contacts</h2>
          <p className="text-sm text-muted" data-contacts-total={total}>
            {data === null && 'Loading…'}
            {data === 'error' && 'Could not load the list.'}
            {data && data !== 'error' && !data.supported && 'Not available yet — run migration 266.'}
            {data && data !== 'error' && data.supported && `${total} ${total === 1 ? 'row' : 'rows'}${source || consent || debouncedQ ? ' match' : ''} · ${data.counts.consented} agreed to marketing`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/api/admin/contacts/export?list=all" className="ea-interactive rounded-lg border border-border px-3 py-2 min-h-[44px] inline-flex items-center text-sm font-semibold text-primary" data-contacts-export="all" download>
            Export CSV
          </a>
          <a href="/api/admin/contacts/export?list=marketing" className="ea-cta rounded-lg px-3 py-2 min-h-[44px] inline-flex items-center text-sm font-semibold" data-contacts-export="marketing" download>
            Export marketing list
          </a>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-secondary mb-1">Source</span>
          <select value={source} onChange={e => { setSource(e.target.value as '' | ContactSource); setPage(1); }} className="w-full rounded-lg border border-border bg-surface px-3 py-2 min-h-[44px] text-sm text-primary" data-contacts-filter-source="">
            <option value="">All</option>
            <option value="notify_signup">Sign-ups</option>
            <option value="inquiry">Inquiries</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-secondary mb-1">Marketing</span>
          <select value={consent} onChange={e => { setConsent(e.target.value as Consent); setPage(1); }} className="w-full rounded-lg border border-border bg-surface px-3 py-2 min-h-[44px] text-sm text-primary" data-contacts-filter-consent="">
            <option value="">All</option>
            <option value="1">Agreed</option>
            <option value="0">Not agreed</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-secondary mb-1">Search</span>
          <input type="search" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Name or email" className="w-full rounded-lg border border-border bg-surface px-3 py-2 min-h-[44px] text-sm text-primary" data-contacts-search="" />
        </label>
      </div>

      <ul className="mt-4 divide-y divide-border" data-contacts-rows="">
        {rows.map(r => {
          const isOpen = open === r.id;
          return (
            <li key={r.id} className="py-3" data-contact-row={r.source}>
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-primary truncate">
                    {r.name ?? <span className="text-muted font-normal">No name</span>}
                    <span className="ml-2 text-xs font-medium text-brand-fg">{r.source === 'inquiry' ? 'Inquiry' : 'Sign-up'}</span>
                    {r.marketing_consent && <span className="ml-2 text-xs font-medium text-success-fg">Marketing: agreed</span>}
                  </p>
                  <a href={`mailto:${r.email}`} className="text-sm text-secondary underline break-all">{r.email}</a>
                  {r.user_type && <span className="ml-2 text-xs text-muted">({r.user_type})</span>}
                </div>
                <time className="text-xs text-muted shrink-0" dateTime={r.created_at}>{formatDate(r.created_at)}</time>
              </div>
              {r.message && (
                <div className="mt-1">
                  {isOpen ? (
                    <p className="text-sm text-primary whitespace-pre-wrap" data-contact-message="open">{r.message}</p>
                  ) : (
                    <button type="button" onClick={() => setOpen(r.id)} className="text-left text-sm text-secondary line-clamp-2 min-h-[44px]" data-contact-message="preview">
                      {r.message}
                    </button>
                  )}
                  {isOpen && (
                    <button type="button" onClick={() => setOpen(null)} className="mt-1 text-xs font-medium text-brand-fg underline min-h-[44px]">
                      Show less
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {data && data !== 'error' && data.supported && rows.length === 0 && <li className="py-6 text-sm text-muted text-center">No contacts match.</li>}
      </ul>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="ea-interactive rounded-lg border border-border px-3 py-2 min-h-[44px] disabled:opacity-40" data-contacts-prev="">
            Newer
          </button>
          <span className="text-muted">Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="ea-interactive rounded-lg border border-border px-3 py-2 min-h-[44px] disabled:opacity-40" data-contacts-next="">
            Older
          </button>
        </div>
      )}
    </section>
  );
}
