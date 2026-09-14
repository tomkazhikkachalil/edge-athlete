'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { BACKFILL_SOURCES, type BackfillSource, type BackfillSummary } from '@/lib/performance/backfill';

// ── Performance backfill — the dashboard's door (data foundation, F5b) ─────
// The admin route (`POST /api/admin/performance-backfill`) is dry-run by
// default and one source per call; this panel is how an owner runs it
// without a developer console: the four sources in the ORDER the doc
// requires (the league overlays land last), "Dry run all" first, then
// "Run for real" behind the house confirm. A live run walks every page
// (`nextCursor` while `truncated`) so one click finishes a source.

const LABEL: Record<BackfillSource, string> = {
  golf_rounds: 'Golf rounds',
  posts: 'Stat-line posts',
  contest_stat_lines: 'Org-entered stat lines',
  contest_results: 'Golf league results (the overlays)',
};

type Line =
  | { status: 'idle' }
  | { status: 'running'; pages: number }
  | { status: 'done'; summary: BackfillSummary; pages: number }
  | { status: 'error'; message: string };

const btn = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';

async function runSource(source: BackfillSource, live: boolean, onPage: (pages: number) => void): Promise<BackfillSummary> {
  let cursor: string | null = null;
  let total: BackfillSummary | null = null;
  for (let page = 0; page < 200; page++) {
    const res = await fetch('/api/admin/performance-backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, dryRun: !live, ...(cursor ? { cursor } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as Partial<BackfillSummary> & { error?: string };
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    const s = body as BackfillSummary;
    if (!total) total = { ...s, skipped: { ...s.skipped } };
    else {
      total.scanned += s.scanned;
      total.mapped += s.mapped;
      total.upserted += s.upserted;
      for (const [k, v] of Object.entries(s.skipped)) total.skipped[k] = (total.skipped[k] ?? 0) + v;
    }
    onPage(page + 1);
    if (!s.truncated || !s.nextCursor) {
      total.truncated = false;
      total.nextCursor = null;
      return total;
    }
    cursor = s.nextCursor;
  }
  if (total) return total;
  throw new Error('no answer');
}

export default function PerformanceBackfillPanel() {
  const [lines, setLines] = useState<Record<BackfillSource, Line>>({ golf_rounds: { status: 'idle' }, posts: { status: 'idle' }, contest_stat_lines: { status: 'idle' }, contest_results: { status: 'idle' } });
  const [busy, setBusy] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [lastMode, setLastMode] = useState<'dry' | 'live' | null>(null);

  const setLine = (source: BackfillSource, line: Line) => setLines(prev => ({ ...prev, [source]: line }));

  const runAll = async (live: boolean) => {
    setBusy(true);
    setLastMode(live ? 'live' : 'dry');
    for (const source of BACKFILL_SOURCES) {
      setLine(source, { status: 'running', pages: 0 });
      try {
        const summary = await runSource(source, live, pages => setLine(source, { status: 'running', pages }));
        setLine(source, { status: 'done', summary, pages: 1 });
      } catch (e) {
        setLine(source, { status: 'error', message: e instanceof Error ? e.message : 'failed' });
        break; // the order matters — a failed source stops the run
      }
    }
    setBusy(false);
  };

  const dryDone = BACKFILL_SOURCES.every(s => lines[s].status === 'done') && lastMode === 'dry';

  return (
    <section aria-label="Performance backfill" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-admin-performance-backfill="">
      <h2 className="text-lg font-semibold text-primary mb-1">Performance backfill</h2>
      <p className="text-xs text-muted mb-3">
        Projects the rounds, stat-line posts, org-entered lines and league results that predate the write hooks into the performance dataset
        (docs/PERFORMANCE_DATA.md). Safe to repeat — every row is keyed by its origin. Dry run first, then run for real.
      </p>
      <ol className="space-y-2 mb-4">
        {BACKFILL_SOURCES.map((source, i) => {
          const line = lines[source];
          return (
            <li key={source} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-backfill-source={source} data-backfill-status={line.status}>
              <span className="font-medium text-primary">{i + 1}. {LABEL[source]}</span>
              <span className="text-xs text-muted min-w-0">
                {line.status === 'idle' && 'Not run yet.'}
                {line.status === 'running' && `Running… ${line.pages ? `page ${line.pages}` : ''}`}
                {line.status === 'error' && <span className="text-red-600 dark:text-red-400">Failed: {line.message}</span>}
                {line.status === 'done' && (
                  <>
                    {line.summary.scanned} scanned · {line.summary.mapped} mapped ·{' '}
                    <span className="font-medium text-primary">{line.summary.upserted} written</span>
                    {Object.keys(line.summary.skipped).length > 0 && (
                      <> · skipped {Object.entries(line.summary.skipped).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')}</>
                    )}
                    {line.summary.dryRun && ' (dry run — nothing written)'}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-3">
        <button type="button" disabled={busy} onClick={() => runAll(false)} className={btn} data-backfill-dry="">
          {busy && lastMode === 'dry' ? 'Dry running…' : 'Dry run all'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmLive(true)}
          className={`${btn} ${dryDone ? 'border-brand text-brand-fg' : ''}`}
          data-backfill-live=""
        >
          {busy && lastMode === 'live' ? 'Running…' : 'Run for real'}
        </button>
        <p className="text-xs text-muted min-w-0">
          {dryDone ? 'Dry run complete — read the counts, then run for real.' : 'Runs the four sources in order; the league results go last so their overlays win.'}
        </p>
      </div>
      <ConfirmModal
        isOpen={confirmLive}
        title="Run the performance backfill?"
        message="This writes rows into the performance dataset for every source, in order. It is safe to repeat, and nothing outside that table changes."
        confirmText="Run for real"
        onConfirm={() => {
          setConfirmLive(false);
          void runAll(true);
        }}
        onCancel={() => setConfirmLive(false)}
      />
    </section>
  );
}
