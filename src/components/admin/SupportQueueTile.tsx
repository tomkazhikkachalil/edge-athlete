'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TicketStats } from '@/lib/tickets/server';

/**
 * The dashboard's door to the support queue (Support & Reporting, Spec 1):
 * the open and overdue counts from /api/admin/tickets/stats. Renders the
 * tile even while the counts load (or fail) so the door never disappears;
 * pre-222 the API answers supported:false and the tile says so.
 */
export default function SupportQueueTile() {
  const router = useRouter();
  const [stats, setStats] = useState<TicketStats | null | 'error'>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/tickets/stats', { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setStats('error'); return; }
        const data = (await res.json()) as TicketStats;
        if (!cancelled) setStats(data);
      } catch {
        if (!cancelled) setStats('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const open = stats && stats !== 'error' && stats.supported ? Object.values(stats.counts.openByType).reduce((a, b) => a + b, 0) : null;
  const overdue = stats && stats !== 'error' && stats.supported ? stats.counts.overdue : null;
  const critical = stats && stats !== 'error' && stats.supported ? stats.counts.openBySeverity.critical : null;

  return (
    <button
      type="button"
      onClick={() => router.push('/dashboard/tickets')}
      className="bg-surface rounded-lg shadow-sm border border-border p-4 text-left hover:border-violet-300 transition"
      data-support-queue-tile=""
    >
      <p className="text-sm font-semibold text-primary">
        <i className="fas fa-life-ring text-brand-fg mr-2"></i>
        Support queue
        {critical !== null && critical > 0 && (
          <span className="ml-2 inline-flex items-center rounded-full bg-red-600 text-white px-2 py-0.5 text-xs font-semibold">{critical} critical</span>
        )}
      </p>
      <p className="text-xs text-muted mt-1">
        {stats === null && 'Help requests, reports and suggestions.'}
        {stats === 'error' && 'Help requests, reports and suggestions — counts unavailable.'}
        {stats !== null && stats !== 'error' && !stats.supported && 'Not available yet — run migration 222.'}
        {open !== null && `${open} open${overdue ? ` · ${overdue} overdue` : ''}${stats !== 'error' && stats?.medianHoursToResolve !== null && stats?.medianHoursToResolve !== undefined ? ` · median ${stats.medianHoursToResolve} h to resolve` : ''}`}
      </p>
    </button>
  );
}
