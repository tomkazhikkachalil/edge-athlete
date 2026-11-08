'use client';

import { useEffect, useState } from 'react';
import type { BuildSummary } from '@/lib/observability/page-timings-rules';

/**
 * The Page timings card (performance program Phase 0.4, Nov 2026): what real
 * browsers measured, per BUILD — the one place that answers "did this deploy
 * make it slower". p75 of LCP / INP / CLS / TTFB on phones and desktops for
 * the last ten builds, newest first; the thresholds are the page timings'
 * own (LCP 2.5 s, INP 200 ms, CLS 0.1, TTFB 800 ms — green under, amber to
 * the "poor" line, red past it).
 */
type Answer = { ok: true; builds: BuildSummary[]; rows: number } | { ok: false; error: string };

const METRICS = ['LCP', 'INP', 'CLS', 'TTFB'] as const;
const GOOD: Record<(typeof METRICS)[number], number> = { LCP: 2500, INP: 200, CLS: 0.1, TTFB: 800 };
const POOR: Record<(typeof METRICS)[number], number> = { LCP: 4000, INP: 500, CLS: 0.25, TTFB: 1800 };

function tone(metric: (typeof METRICS)[number], v: number | undefined): string {
  if (v === undefined) return 'text-faint';
  if (v <= GOOD[metric]) return 'text-success';
  if (v <= POOR[metric]) return 'text-warning';
  return 'text-danger';
}
function fmt(metric: (typeof METRICS)[number], v: number | undefined): string {
  if (v === undefined) return '—';
  return metric === 'CLS' ? v.toFixed(3) : `${Math.round(v)} ms`;
}

export default function PageTimingsPanel() {
  const [answer, setAnswer] = useState<Answer | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/page-timings', { cache: 'no-store' });
        const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as Answer;
        if (!cancelled) setAnswer(json);
      } catch (e) {
        if (!cancelled) setAnswer({ ok: false, error: e instanceof Error ? e.message : 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-label="Page timings" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-admin-page-timings="">
      <h2 className="text-lg font-semibold text-primary">Page timings by build</h2>
      <p className="text-sm text-muted mt-1">What real browsers measured on each deploy — p75, the last ten builds, newest first. Green is the page timings &ldquo;good&rdquo; line, red is &ldquo;poor&rdquo;.</p>
      {!answer ? (
        <p className="text-sm text-muted mt-4">Reading…</p>
      ) : !answer.ok ? (
        <p className="text-sm text-muted mt-4">{answer.error}</p>
      ) : answer.builds.length === 0 ? (
        <p className="text-sm text-muted mt-4">No measurements yet — the first opens after this deploy will fill it.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-3 font-medium">build</th>
                <th className="py-1 pr-3 font-medium">samples</th>
                {(['phone', 'desktop'] as const).map((d) => METRICS.map((m) => <th key={`${d}-${m}`} className="py-1 pr-3 font-medium whitespace-nowrap">{d === 'phone' ? '📱' : '🖥'} {m}</th>))}
              </tr>
            </thead>
            <tbody>
              {answer.builds.map((b) => (
                <tr key={b.build} className="border-t border-border">
                  <td className="py-1 pr-3 font-mono text-xs">{b.build.slice(0, 8)}</td>
                  <td className="py-1 pr-3">{b.samples}</td>
                  {(['phone', 'desktop'] as const).map((d) => METRICS.map((m) => <td key={`${d}-${m}`} className={`py-1 pr-3 whitespace-nowrap ${tone(m, b.p75[d][m])}`}>{fmt(m, b.p75[d][m])}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-faint mt-2">{answer.rows} measurements in the last 14 days; the daily cron keeps 30.</p>
        </div>
      )}
    </section>
  );
}
