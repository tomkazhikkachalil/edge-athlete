'use client';

import { useEffect, useState } from 'react';
import { sparklinePoints, type SiteStats, type StatsRange } from '@/lib/org-sites/analytics-rollup';

// ── Visitors — program 2, E2 (Sep 11 2026) ─────────────────────────────────
// The site's own numbers, from the first-party pixel: views and visitors
// for the last 7 / 30 / 90 days, a sparkline (pure SVG — no chart library),
// the top pages. Counting starts when the site is live; nothing personal is
// stored, so nothing personal can be shown.

const RANGES: StatsRange[] = [7, 30, 90];

export default function SiteVisitorsCard({ plural, orgId }: { plural: 'leagues' | 'clubs'; orgId: string }) {
  const [days, setDays] = useState<StatsRange>(30);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'unsupported' | 'error'; stats: SiteStats | null; live: boolean; counting: boolean }>({ status: 'loading', stats: null, live: false, counting: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/${plural}/${orgId}/site/stats?days=${days}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: 'error', stats: null, live: false, counting: true });
          return;
        }
        const body = (await res.json()) as { supported: boolean; live?: boolean; counting?: boolean; stats?: SiteStats };
        if (cancelled) return;
        if (!body.supported || !body.stats) {
          setState({ status: 'unsupported', stats: null, live: false, counting: true });
          return;
        }
        setState({ status: 'ready', stats: body.stats, live: body.live === true, counting: body.counting !== false });
      } catch {
        if (!cancelled) setState({ status: 'error', stats: null, live: false, counting: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plural, orgId, days]);

  if (state.status === 'unsupported') return null;
  const s = state.stats;
  const width = 320;
  const height = 48;

  return (
    <section id="visitors" aria-label="Visitors" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-site-visitors="">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-semibold text-primary">Visitors</h2>
        <div role="radiogroup" aria-label="Range" className="inline-flex rounded-md border border-border-strong p-0.5">
          {RANGES.map(r => (
            <button key={r} type="button" role="radio" aria-checked={days === r} onClick={() => setDays(r)} className={`min-h-[36px] rounded px-2.5 text-xs font-medium ${days === r ? 'bg-brand text-white' : 'text-secondary hover:bg-surface-sunken'}`} data-site-visitors-range={r}>
              {r} days
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-tertiary mb-3">Counting starts when your site is live. No cookies; nothing personal is stored — a visitor is one browser, counted once a day.</p>
      {state.status === 'loading' ? (
        <div className="h-16 animate-pulse rounded bg-surface-sunken" />
      ) : state.status === 'error' || !s ? (
        <p className="text-sm text-red-600">Could not load the numbers. Try again in a moment.</p>
      ) : (
        <>
          {!state.counting && <p className="mb-2 text-xs text-amber-700">Counting is not configured on this deployment yet.</p>}
          <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
            <div className="rounded-lg border border-border p-3">
              <p className="text-2xl font-bold text-primary" data-site-visitors-views="">{s.totals.views.toLocaleString()}</p>
              <p className="text-xs text-tertiary">page views</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-2xl font-bold text-primary" data-site-visitors-visitors="">{s.totals.visitors.toLocaleString()}</p>
              <p className="text-xs text-tertiary">visitors</p>
            </div>
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-12 w-full max-w-sm" role="img" aria-label={`Page views per day over the last ${s.days} days`}>
            <polyline fill="none" stroke="var(--brand, #7c3aed)" strokeWidth="2" points={sparklinePoints(s.series, width, height)} />
          </svg>
          {s.topPaths.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm" aria-label="Top pages">
              {s.topPaths.map(p => (
                <li key={p.path} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-primary">{p.path === '/' ? 'Home' : p.path}</span>
                  <span className="shrink-0 text-xs text-tertiary">
                    {p.views} view{p.views === 1 ? '' : 's'} · {p.visitors} visitor{p.visitors === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-tertiary">{state.live ? 'No visits in this range yet.' : 'Your site is not live yet.'}</p>
          )}
        </>
      )}
    </section>
  );
}
