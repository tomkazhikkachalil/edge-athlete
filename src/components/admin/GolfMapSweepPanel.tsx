'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import type { SweepBatchSummary } from '@/lib/golf/map-sweep';
import type { PlanResult, SweepProgress } from '@/lib/golf/map-sweep-server';

// ── The course-map sweep — the dashboard's door (map sweep PR 7, Oct 2026) ─
// `POST /api/admin/golf-map-sweep` is dry-run by default and one batch per
// call (a minute's work); pg_cron ticks the same phases every two minutes
// once migration 255 has run. This panel is how the owner reads the sweep
// and runs it without a developer console: the progress (cells, courses by
// tier, elevation, hydration, the two budgets), the next ten cells, "Plan
// cells" (dry → live), "Dry run a batch", "Run a batch" behind the house
// confirm, "Run until done" (loops while cells remain and the budget holds —
// Stop at any time) and "Sweep one cell" (a key, prefilled with Ottawa's).

type Phase = 'geometry' | 'elevation' | 'hydration';

const PHASE_LABEL: Record<Phase, string> = {
  geometry: 'Hole lines + greens (Overpass)',
  elevation: 'Elevation profiles (Terrain Tiles)',
  hydration: 'Tee sheets (provider rows)',
};

const TIER_LABEL = ['Ottawa / played', 'Canada', 'US · GB · IE · AU', 'Rest of world'];

/** Ottawa's first cell — the rollout's first stop. */
export const OTTAWA_CELL = 'c05:45.0:-76.0';

const btn = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';
const fieldCls = 'min-h-[36px] rounded-md border border-border-strong bg-surface px-2 text-sm text-primary';

type Outcome =
  | { kind: 'plan'; result: PlanResult }
  | { kind: 'batch'; result: SweepBatchSummary; batches: number }
  | { kind: 'error'; message: string };

/** One line for a batch: what the cells did, in the summary's own words. */
export function describeBatch(s: SweepBatchSummary): string {
  if (s.phase !== 'geometry') {
    return `${s.cells.length} ${s.phase === 'elevation' ? 'courses' : 'rows'} · ${s.cells.filter(c => c.outcome === 'done').length} done${s.dryRun ? ' (dry run — nothing written)' : ''}`;
  }
  const parts = s.cells.map(c => {
    const m = c.metrics;
    const head = `${c.cell_key} ${c.outcome}`;
    if (!m) return c.error ? `${head} (${c.error})` : head;
    return `${head}: ${m.mapped}/${m.attempted} mapped (${m.with_greens} greens · ${m.sections} nines · ${m.derived} derived · ${m.greens_only} greens-only), ${m.null_no_coverage} no coverage`;
  });
  return `${parts.join(' · ') || 'nothing to do'}${s.dryRun ? ' (dry run — nothing written)' : ''}`;
}

async function readProgress(): Promise<{ progress: SweepProgress | null; error: string | null }> {
  try {
    const res = await fetch('/api/admin/golf-map-sweep', { cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as SweepProgress | { error?: string };
    if (!res.ok || !('ok' in json)) return { progress: null, error: ('error' in json && json.error) || `HTTP ${res.status}` };
    return { progress: json, error: null };
  } catch (e) {
    return { progress: null, error: e instanceof Error ? e.message : 'failed' };
  }
}

async function postSweep(body: Record<string, unknown>): Promise<PlanResult | SweepBatchSummary> {
  const res = await fetch('/api/admin/golf-map-sweep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as unknown as PlanResult | SweepBatchSummary;
}

export default function GolfMapSweepPanel() {
  const [progress, setProgress] = useState<SweepProgress | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('geometry');
  const [cellKey, setCellKey] = useState(OTTAWA_CELL);
  const [busy, setBusy] = useState<'plan-dry' | 'plan' | 'dry' | 'live' | 'loop' | 'cell' | null>(null);
  const [confirm, setConfirm] = useState<'plan' | 'live' | 'loop' | 'cell' | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const stopRef = useRef(false);

  const refresh = useCallback(async () => {
    const r = await readProgress();
    setProgress(r.progress);
    setProgressError(r.error);
  }, []);

  // The mount-time read is inlined as a cancellable async effect (the house
  // pattern for set-state-in-effect — the rule cannot see through a callback).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await readProgress();
      if (cancelled) return;
      setProgress(r.progress);
      setProgressError(r.error);
    })();
    return () => { cancelled = true; };
  }, []);

  const run = async (mode: NonNullable<typeof busy>) => {
    setBusy(mode);
    stopRef.current = false;
    try {
      if (mode === 'plan-dry' || mode === 'plan') {
        const result = (await postSweep({ phase: 'plan', dryRun: mode === 'plan-dry' })) as PlanResult;
        setOutcome({ kind: 'plan', result });
      } else if (mode === 'cell') {
        const result = (await postSweep({ phase: 'geometry', cells: 1, cellKey: cellKey.trim(), dryRun: false })) as SweepBatchSummary;
        setOutcome({ kind: 'batch', result, batches: 1 });
      } else {
        const live = mode !== 'dry';
        let batches = 0;
        let last: SweepBatchSummary | null = null;
        // "Run until done" loops one batch at a time (each its own minute);
        // the server's `remaining` and `budgetExhausted` end it, or Stop.
        for (let i = 0; i < 2000; i++) {
          last = (await postSweep({ phase, dryRun: !live })) as SweepBatchSummary;
          batches += 1;
          setOutcome({ kind: 'batch', result: last, batches });
          if (mode !== 'loop' || stopRef.current || last.remaining <= 0 || last.budgetExhausted) break;
          await refresh();
        }
      }
    } catch (e) {
      setOutcome({ kind: 'error', message: e instanceof Error ? e.message : 'failed' });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const budgetLine = (key: 'sweep-overpass' | 'sweep-terrain') => {
    const b = progress?.budgets[key];
    return b ? `${b.count} today` : 'unused today';
  };

  return (
    <section aria-label="Course map sweep" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-admin-golf-map-sweep="">
      <h2 className="text-lg font-semibold text-primary mb-1">Course map sweep</h2>
      <p className="text-xs text-muted mb-3">
        Maps every golf course OpenStreetMap can map — hole lines, green outlines, pickable nines, lines drawn from numbered tees and greens,
        nearest-green courses — one half-degree cell at a time, then the elevation profiles and the provider tee sheets (docs/GOLF_COURSE_DATA.md).
        The schedule runs it every two minutes; this is the owner&apos;s door. A dry run writes nothing.
      </p>

      {progressError ? (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3" data-sweep-progress-error="">
          {progressError.includes('255') ? 'Migration 255 has not run on this database yet.' : `Progress unavailable: ${progressError}`}
        </p>
      ) : progress ? (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm mb-4" data-sweep-progress="">
          <div>
            <dt className="text-xs text-muted">Cells</dt>
            <dd className="font-medium text-primary" data-sweep-cells="">
              {progress.cells.done} / {progress.cells.total} done
              {progress.cells.stale > 0 && <span className="text-muted font-normal"> · {progress.cells.stale} due again</span>}
              {progress.cells.running > 0 && <span className="text-muted font-normal"> · {progress.cells.running} running</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Courses mapped</dt>
            <dd className="font-medium text-primary" data-sweep-courses="">
              {progress.courses.mapped} of {progress.courses.attempted} swept
              <span className="block text-xs text-muted font-normal">
                {progress.courses.with_greens} with greens · {progress.courses.sections} nines · {progress.courses.derived} derived · {progress.courses.greens_only} greens-only
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Not mapped</dt>
            <dd className="font-medium text-primary" data-sweep-unmapped="">
              {progress.courses.null_no_coverage} nothing in OSM
              {Object.keys(progress.courses.refused).length > 0 && (
                <span className="block text-xs text-muted font-normal">
                  refused: {Object.entries(progress.courses.refused).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Elevation · tee sheets</dt>
            <dd className="font-medium text-primary" data-sweep-elevation="">
              {progress.elevation.done} done · {progress.elevation.due} due
              <span className="block text-xs text-muted font-normal">{progress.hydrationDue} provider rows awaiting a sheet</span>
            </dd>
          </div>
          <div className="col-span-2 sm:col-span-4 text-xs text-muted" data-sweep-budgets="">
            Budgets: Overpass {budgetLine('sweep-overpass')} · Terrain Tiles {budgetLine('sweep-terrain')}
            {progress.lastRun && typeof progress.lastRun === 'object' && 'at' in progress.lastRun ? ` · last run ${String((progress.lastRun as { at: unknown }).at)}` : ''}
          </div>
        </dl>
      ) : (
        <p className="text-xs text-muted mb-3">Loading…</p>
      )}

      {progress && progress.next.length > 0 && (
        <details className="mb-4 text-sm">
          <summary className="cursor-pointer text-secondary">Next up ({progress.next.length})</summary>
          <ol className="mt-2 space-y-1 text-xs text-muted" data-sweep-next="">
            {progress.next.map(c => (
              <li key={c.cell_key} data-sweep-next-cell={c.cell_key}>
                <span className="font-mono text-primary">{c.cell_key}</span> · {TIER_LABEL[c.tier] ?? `tier ${c.tier}`} · {c.courses} courses
                {c.rounds > 0 ? ` · ${c.rounds} rounds played` : ''} · {c.status}
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-3">
        <button type="button" disabled={!!busy} onClick={() => run('plan-dry')} className={btn} data-sweep-plan-dry="">
          {busy === 'plan-dry' ? 'Planning…' : 'Plan cells (dry run)'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => setConfirm('plan')} className={btn} data-sweep-plan="">
          {busy === 'plan' ? 'Planning…' : 'Plan cells'}
        </button>
        <label className="text-sm text-secondary flex items-center gap-2">
          Phase
          <select value={phase} onChange={e => setPhase(e.target.value as Phase)} disabled={!!busy} className={fieldCls} data-sweep-phase="">
            {(Object.keys(PHASE_LABEL) as Phase[]).map(p => (
              <option key={p} value={p}>{PHASE_LABEL[p]}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!!busy} onClick={() => run('dry')} className={btn} data-sweep-dry="">
          {busy === 'dry' ? 'Dry running…' : 'Dry run a batch'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => setConfirm('live')} className={btn} data-sweep-live="">
          {busy === 'live' ? 'Running…' : 'Run a batch'}
        </button>
        {busy === 'loop' ? (
          <button type="button" onClick={() => { stopRef.current = true; }} className={`${btn} border-brand text-brand-fg`} data-sweep-stop="">
            Stop after this batch
          </button>
        ) : (
          <button type="button" disabled={!!busy} onClick={() => setConfirm('loop')} className={btn} data-sweep-loop="">
            Run until done
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <label className="text-sm text-secondary flex items-center gap-2">
          One cell
          <input
            value={cellKey}
            onChange={e => setCellKey(e.target.value)}
            disabled={!!busy}
            className={`${fieldCls} font-mono w-44`}
            spellCheck={false}
            data-sweep-cell-key=""
          />
        </label>
        <button type="button" disabled={!!busy || !cellKey.trim()} onClick={() => setConfirm('cell')} className={btn} data-sweep-cell="">
          {busy === 'cell' ? 'Sweeping…' : 'Sweep one cell'}
        </button>
        <p className="text-xs text-muted min-w-0">A cell key is its south-west corner on a half-degree grid; Ottawa is {OTTAWA_CELL}.</p>
      </div>

      {outcome && (
        <p className="text-xs text-muted mt-3 min-w-0 break-words" data-sweep-outcome="" data-sweep-outcome-kind={outcome.kind}>
          {outcome.kind === 'error' && <span className="text-red-600 dark:text-red-400">Failed: {outcome.message}</span>}
          {outcome.kind === 'plan' && (
            <>
              <span className="font-medium text-primary">{outcome.result.cells} cells</span> over {outcome.result.courses} courses ·{' '}
              {Object.entries(outcome.result.tiers).map(([t, n]) => `${n} ${TIER_LABEL[Number(t)] ?? `tier ${t}`}`).join(' · ')}
              {outcome.result.dryRun ? ' (dry run — nothing written)' : ''}
            </>
          )}
          {outcome.kind === 'batch' && (
            <>
              {outcome.batches > 1 ? `${outcome.batches} batches · last: ` : ''}
              {describeBatch(outcome.result)}
              {outcome.result.remaining > 0 ? ` · ${outcome.result.remaining} remaining` : ' · nothing remaining'}
              {outcome.result.budgetExhausted ? ' · today’s budget is spent' : ''}
            </>
          )}
        </p>
      )}

      <ConfirmModal
        isOpen={confirm === 'plan'}
        title="Plan the sweep's cells?"
        message="Reads every course with coordinates and writes the cell list. Cells already swept keep their state; only the plan columns change."
        confirmText="Plan cells"
        onConfirm={() => { setConfirm(null); void run('plan'); }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmModal
        isOpen={confirm === 'live'}
        title={`Run one ${PHASE_LABEL[phase].toLowerCase()} batch?`}
        message="This writes what it finds — a mapped course's lines and greens, a stamped attempt where OpenStreetMap has nothing. The lazy map fetch writes the same rows; nothing else changes."
        confirmText="Run a batch"
        onConfirm={() => { setConfirm(null); void run('live'); }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmModal
        isOpen={confirm === 'loop'}
        title={`Run ${PHASE_LABEL[phase].toLowerCase()} until done?`}
        message="Runs batch after batch while cells remain and today's budget holds, each its own minute. Keep this tab open; Stop ends it after the current batch."
        confirmText="Run until done"
        onConfirm={() => { setConfirm(null); void run('loop'); }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmModal
        isOpen={confirm === 'cell'}
        title={`Sweep cell ${cellKey.trim()} now?`}
        message="Fetches this one cell from OpenStreetMap and writes every course in it, whatever its place in the queue."
        confirmText="Sweep one cell"
        onConfirm={() => { setConfirm(null); void run('cell'); }}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
