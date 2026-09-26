'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { actButton, fieldClass } from '@/components/authority/RecoveryKit';

// ── Recovery — find the thing (Authority PR 4) ──────────────────────────────
// The Edge Athlete team's door to the recovery panels: a ticket number, an
// id, a pasted link (club, league, org site, event, custom domain) or a
// name. `?ticket=` carries the ticket into the panel it opens. Owner-only
// today — the API answers 403 to anyone else and this page says so.

interface Hit { subject: 'org' | 'sport_event'; id: string; kind: string; name: string; detail: string | null }

type Fetched = { kind: 'ok'; hits: Hit[]; ticketId: string | null } | { kind: 'forbidden' | 'error' };

async function fetchHits(text: string): Promise<Fetched> {
  try {
    const res = await fetch(`/api/admin/recovery/search?q=${encodeURIComponent(text)}`, { cache: 'no-store' });
    if (res.status === 401 || res.status === 403) return { kind: 'forbidden' };
    if (!res.ok) return { kind: 'error' };
    const data = (await res.json()) as { hits: Hit[]; ticketId: string | null };
    return { kind: 'ok', hits: data.hits, ticketId: data.ticketId };
  } catch {
    return { kind: 'error' };
  }
}

export default function RecoverySearchPage() {
  return (
    <Suspense fallback={null}>
      <RecoverySearch />
    </Suspense>
  );
}

function RecoverySearch() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const ticket = params.get('ticket') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'forbidden' | 'error'>('idle');

  const initialQ = params.get('q') ?? '';

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [loading, user, router]);

  // Arriving from a ticket (?q=EA-1042): run that search once signed in.
  useEffect(() => {
    if (!user || !initialQ.trim()) return;
    let cancelled = false;
    (async () => {
      const out = await fetchHits(initialQ.trim());
      if (!cancelled) apply(out);
    })();
    return () => { cancelled = true; };
  }, [user, initialQ]);

  function apply(out: Awaited<ReturnType<typeof fetchHits>>) {
    if (out.kind !== 'ok') { setState(out.kind); return; }
    setHits(out.hits);
    setTicketId(out.ticketId);
    setState('idle');
  }

  const search = async () => {
    if (!q.trim()) return;
    setState('searching');
    apply(await fetchHits(q.trim()));
  };

  const carry = ticket || ticketId || (/^EA-?\d+$/i.test(q.trim()) ? q.trim().toUpperCase() : '');
  const href = (h: Hit) => `/dashboard/recovery/${h.subject === 'org' ? 'org' : 'event'}/${h.id}${carry ? `?ticket=${encodeURIComponent(carry)}` : ''}`;

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/dashboard/tickets" className="text-sm text-brand-fg hover:underline mb-4 inline-flex items-center gap-2">
          <i className="fas fa-arrow-left text-xs"></i> Support queue
        </Link>
        <h1 className="text-2xl font-bold text-primary mb-1">
          <i className="fas fa-user-shield mr-2 text-brand-fg"></i>
          Recovery
        </h1>
        <p className="text-sm text-tertiary mb-6">
          Give back the running of a club, league or event, or stop someone misusing it. Every change names a support ticket and is recorded.
        </p>

        <form className="flex flex-col sm:flex-row gap-2 mb-6" onSubmit={e => { e.preventDefault(); void search(); }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="EA-1042, a link, a custom domain or a name"
            className={fieldClass}
            aria-label="Find a club, league or event"
            data-recovery-search=""
          />
          <button type="submit" disabled={state === 'searching' || !q.trim()} className={`${actButton} sm:w-32`}>
            {state === 'searching' ? 'Searching…' : 'Find'}
          </button>
        </form>

        {state === 'forbidden' && <p className="text-sm text-tertiary">Recovery is for Edge Athlete owners.</p>}
        {state === 'error' && <p role="alert" className="text-sm text-red-700 dark:text-red-300">The search failed. Try again.</p>}
        {hits && hits.length === 0 && state === 'idle' && <p className="text-sm text-tertiary">Nothing matches. Try the link the person sent, or the site&apos;s address.</p>}
        {hits && hits.length > 0 && (
          <ul className="space-y-2" data-recovery-hits="">
            {hits.map(h => (
              <li key={`${h.subject}:${h.id}`}>
                <Link href={href(h)} className="ea-surface ea-interactive rounded-lg p-4 flex items-center gap-3 min-h-[44px]" data-recovery-hit={h.id}>
                  <i className={`fas ${h.subject === 'org' ? (h.kind === 'league' ? 'fa-trophy' : 'fa-building') : 'fa-flag-checkered'} text-brand-fg`} aria-hidden="true"></i>
                  <span className="min-w-0">
                    <span className="block font-semibold text-primary truncate">{h.name}</span>
                    <span className="block text-xs text-muted">{h.subject === 'org' ? h.kind : `event · ${h.kind}`}{h.detail ? ` · ${h.detail}` : ''}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
