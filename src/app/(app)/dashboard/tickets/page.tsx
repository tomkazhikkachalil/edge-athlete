'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { SeverityChip, StatusChip, TypeChip, ago, reasonLabel } from '@/components/tickets/ticket-ui';
import { TICKET_SEVERITIES, TICKET_TYPES, type TicketSeverity, type TicketType } from '@/lib/tickets/types';
import type { AdminTicketView } from '@/lib/tickets/visibility';
import type { QueueCounts } from '@/lib/tickets/server';

// The support queue (Support & Reporting, Spec 1): open tickets sorted
// severity first, then age, with an overdue marker and the open counts.
// Authorization lives in the API (requireModerator — owner or moderator);
// a 403 here renders the forbidden state, never a redirect loop. One
// column at every width; the row IS the link to the ticket.

type StatusFilter = 'open' | 'resolved' | 'closed' | 'all';
const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

export default function SupportQueuePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error' | 'unsupported'>('loading');
  const [tickets, setTickets] = useState<AdminTicketView[]>([]);
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [type, setType] = useState<TicketType | ''>('');
  const [severity, setSeverity] = useState<TicketSeverity | ''>('');
  const [q, setQ] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  const query = useCallback(() => {
    const sp = new URLSearchParams({ status });
    if (type) sp.set('type', type);
    if (severity) sp.set('severity', severity);
    if (q.trim()) sp.set('q', q.trim());
    return sp.toString();
  }, [status, type, severity, q]);

  useEffect(() => {
    if (!loading && !user) router.replace('/');
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/tickets?${query()}`, { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) { setState('forbidden'); return; }
        if (!res.ok) { setState('error'); return; }
        const data = (await res.json()) as { supported: boolean; tickets: AdminTicketView[]; counts: QueueCounts };
        if (cancelled) return;
        setTickets(data.tickets);
        setCounts(data.counts);
        setState(data.supported ? 'ready' : 'unsupported');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading, router, query, retryKey]);

  const openTotal = counts ? Object.values(counts.openByType).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <button type="button" onClick={() => router.push('/dashboard')} className="text-sm text-brand-fg hover:underline mb-4 inline-flex items-center gap-2">
          <i className="fas fa-arrow-left text-xs"></i> Admin
        </button>
        <h1 className="text-2xl font-bold text-primary mb-1">
          <i className="fas fa-life-ring mr-2 text-brand-fg"></i>
          Support queue
        </h1>
        <p className="text-sm text-tertiary mb-6">Help requests, reports and suggestions — critical first, then oldest. Targets are guidance; nothing escalates on its own.</p>

        {counts && (
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" aria-label="Open counts">
            <Stat label="Open" value={openTotal} />
            <Stat label="Overdue" value={counts.overdue} tone={counts.overdue > 0 ? 'warn' : undefined} />
            <Stat label="Critical" value={counts.openBySeverity.critical} tone={counts.openBySeverity.critical > 0 ? 'danger' : undefined} />
            <Stat label="Reports" value={counts.openByType.report} />
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={status === f.key}
                onClick={() => setStatus(f.key)}
                className={`px-3 py-1.5 min-h-[36px] rounded-full text-xs font-semibold border transition ea-interactive ${status === f.key ? 'bg-brand text-white border-brand' : 'bg-surface text-secondary border-border'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select aria-label="Type" value={type} onChange={e => setType(e.target.value as TicketType | '')} className="min-h-[36px] rounded-lg border border-border bg-surface px-2 text-sm text-primary">
            <option value="">All types</option>
            {TICKET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select aria-label="Severity" value={severity} onChange={e => setSeverity(e.target.value as TicketSeverity | '')} className="min-h-[36px] rounded-lg border border-border bg-surface px-2 text-sm text-primary">
            <option value="">Any severity</option>
            {TICKET_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            type="search"
            aria-label="Search by number or subject"
            placeholder="EA-1042 or a subject"
            value={q}
            onChange={e => setQ(e.target.value)}
            className="min-h-[36px] flex-1 min-w-[10rem] rounded-lg border border-border bg-surface px-3 text-sm text-primary"
          />
        </div>

        {state === 'loading' && <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>}
        {state === 'forbidden' && <p className="text-sm text-tertiary">Support-queue access required.</p>}
        {state === 'unsupported' && <p className="text-sm text-tertiary">Support is not available yet — run migration 222.</p>}
        {state === 'error' && (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <p role="alert" className="text-sm text-tertiary mb-4">Couldn&apos;t load the queue.</p>
            <button type="button" onClick={() => { setState('loading'); setRetryKey(k => k + 1); }} className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] bg-brand text-white rounded-lg text-sm font-semibold hover:bg-brand-hover transition">
              <i className="fas fa-rotate-right text-xs"></i> Try again
            </button>
          </div>
        )}
        {state === 'ready' && tickets.length === 0 && (
          <p className="text-sm text-muted bg-surface border border-border rounded-lg p-6 text-center">Nothing here.</p>
        )}
        {state === 'ready' && tickets.length > 0 && (
          <ul className="space-y-2" data-ticket-queue="">
            {tickets.map(t => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/tickets/${t.id}`)}
                  className="w-full text-left ea-surface ea-surface-raised rounded-lg p-4 ea-interactive"
                  data-ticket-row={t.id}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-muted">{t.numberLabel}</span>
                    <SeverityChip severity={t.severity} />
                    <StatusChip status={t.status} />
                    <TypeChip type={t.type} subtype={t.subtype} />
                    {t.overdue && <span className="inline-flex items-center rounded-full bg-red-600 text-white px-2 py-0.5 text-xs font-semibold" data-ticket-overdue="">Overdue</span>}
                    {t.report_count > 1 && <span className="text-xs text-muted">×{t.report_count}</span>}
                  </div>
                  <p className="text-sm font-semibold text-primary truncate">{t.subject || reasonLabel(t.type, t.reason)}</p>
                  <p className="text-xs text-muted mt-1">
                    {reasonLabel(t.type, t.reason)} · opened {ago(t.created_at)}
                    {t.assignee_profile_id ? ' · assigned' : ' · unassigned'}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'danger' }) {
  const toneClass = tone === 'danger' ? 'text-red-700 dark:text-red-300' : tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : 'text-primary';
  return (
    <div className="ea-surface rounded-lg p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}
