'use client';

import { useCallback, useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import type { TickSummary } from '@/lib/media/process-server';

// ── The media worker — the dashboard's door (video posters PR 7, Oct 2026) ──
// `GET /api/admin/media-jobs` is the queue's numbers; `POST` is dry-run by
// default: `plan` lists the older media that need a job (PR 9's backfill —
// a live plan enqueues them), `run` claims and runs ONE tick in the request
// (the cron's twin, for a preview deployment or a stuck queue), `retry`
// re-queues every failed job. pg_cron ticks the same worker every minute
// once migration 262 has run. The kill switch (`MEDIA_JOBS=0`) shows as a
// banner — the worker is off and no new row reads "processing".

type Status = {
  ok: true;
  counts: Record<string, number>;
  recent: Array<{ id: string; kind: string; target_table: string; status: string; attempts: number; error: string | null; finished_at: string | null; created_at: string }>;
  enabled: boolean;
  maxRunning: number;
};

type PlanResult = { ok: true; counts: Record<string, number>; sample: Array<{ table: string; id: string; kind: string }>; enqueued: number; dryRun: boolean };

type Outcome =
  | { kind: 'plan'; result: PlanResult }
  | { kind: 'tick'; result: TickSummary & { dryRun: boolean } }
  | { kind: 'retry'; result: { wouldRetry?: number; retried?: number; dryRun: boolean } }
  | { kind: 'error'; message: string };

const btn = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';

async function readStatus(): Promise<{ status: Status | null; error: string | null }> {
  try {
    const res = await fetch('/api/admin/media-jobs', { cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as Status | { error?: string };
    if (!res.ok || !('ok' in json)) return { status: null, error: ('error' in json && json.error) || `HTTP ${res.status}` };
    return { status: json, error: null };
  } catch (e) {
    return { status: null, error: e instanceof Error ? e.message : 'failed' };
  }
}

async function postAction<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/admin/media-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as unknown as T;
}

/** One line for a tick: what the jobs did, in the summary's own words. */
export function describeTick(s: TickSummary & { dryRun?: boolean }): string {
  if (s.disabled) return 'The worker is off (MEDIA_JOBS=0).';
  if (s.claimed === 0) return `nothing due${s.dryRun ? ' (dry run)' : ''}`;
  const by: Record<string, number> = {};
  for (const o of s.outcomes) by[o.outcome] = (by[o.outcome] ?? 0) + 1;
  const parts = Object.entries(by).map(([k, n]) => `${n} ${k}`);
  return `${s.claimed} claimed · ${parts.join(' · ')} · ${Math.round(s.elapsedMs / 1000)} s${s.dryRun ? ' (dry run — nothing written)' : ''}`;
}

export default function MediaJobsPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'plan-dry' | 'plan' | 'run-dry' | 'run' | 'retry' | null>(null);
  const [confirm, setConfirm] = useState<'plan' | 'run' | 'retry' | null>(null);
  const [includeBlur, setIncludeBlur] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const refresh = useCallback(async () => {
    const r = await readStatus();
    setStatus(r.status);
    setStatusError(r.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await readStatus();
      if (cancelled) return;
      setStatus(r.status);
      setStatusError(r.error);
    })();
    return () => { cancelled = true; };
  }, []);

  const run = async (mode: NonNullable<typeof busy>) => {
    setBusy(mode);
    try {
      if (mode === 'plan-dry' || mode === 'plan') {
        const result = await postAction<PlanResult>({ action: 'plan', dryRun: mode === 'plan-dry', includeBlur });
        setOutcome({ kind: 'plan', result });
      } else if (mode === 'retry') {
        const result = await postAction<{ wouldRetry?: number; retried?: number; dryRun: boolean }>({ action: 'retry', dryRun: false });
        setOutcome({ kind: 'retry', result });
      } else {
        const result = await postAction<TickSummary & { dryRun: boolean }>({ action: 'run', dryRun: mode === 'run-dry' });
        setOutcome({ kind: 'tick', result });
      }
    } catch (e) {
      setOutcome({ kind: 'error', message: e instanceof Error ? e.message : 'failed' });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const count = (k: string) => status?.counts[k] ?? 0;
  const notReady = !!statusError && statusError.includes('261');

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-6" data-media-jobs-panel="">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold text-primary">Media jobs</h2>
          <p className="text-sm text-secondary mt-1">
            Converts iPhone (HEVC) clips so every phone plays them, and makes a poster and a blurred placeholder for any video without one. The cron ticks every minute; this is the door.
          </p>
        </div>
        <button type="button" className={btn} onClick={() => void refresh()} disabled={busy !== null}>Refresh</button>
      </div>

      {status && !status.enabled && (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" role="status">
          The worker is OFF (<code>MEDIA_JOBS=0</code>): nothing runs and no new upload reads &ldquo;processing&rdquo;.
        </p>
      )}
      {statusError && (
        <p className="mb-3 text-sm text-secondary" role="status">
          {notReady ? 'Migration 261 has not run here yet — the job table does not exist.' : `Could not read the queue: ${statusError}`}
        </p>
      )}

      {status && (
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4 text-sm" data-media-jobs-counts="">
          {(['queued', 'running', 'parked', 'done', 'failed'] as const).map(k => (
            <div key={k} className="rounded-md border border-border bg-surface-sunken px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-faint">{k}</dt>
              <dd className="text-xl font-semibold text-primary">{count(k)}</dd>
              <dd className="text-xs text-secondary">
                {count(`${k}:video`)} video · {count(`${k}:poster`)} poster · {count(`${k}:blur`)} blur
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button type="button" className={btn} disabled={busy !== null || notReady} onClick={() => void run('run-dry')}>Dry run a tick</button>
        <button type="button" className={btn} disabled={busy !== null || notReady} onClick={() => setConfirm('run')}>Run a tick</button>
        <button type="button" className={btn} disabled={busy !== null || notReady} onClick={() => void run('plan-dry')}>Plan backfill (dry)</button>
        <button type="button" className={btn} disabled={busy !== null || notReady} onClick={() => setConfirm('plan')}>Enqueue backfill</button>
        <button type="button" className={btn} disabled={busy !== null || notReady || count('failed') === 0} onClick={() => setConfirm('retry')}>Retry failed ({count('failed')})</button>
        <label className="flex items-center gap-2 text-sm text-secondary ml-1">
          <input type="checkbox" checked={includeBlur} onChange={e => setIncludeBlur(e.target.checked)} />
          include blur-only rows
        </label>
      </div>

      {outcome && (
        <p className="text-sm text-secondary mb-3" role="status" data-media-jobs-outcome="">
          {outcome.kind === 'error'
            ? `Failed: ${outcome.message}`
            : outcome.kind === 'tick'
              ? describeTick(outcome.result)
              : outcome.kind === 'retry'
                ? `${outcome.result.retried ?? outcome.result.wouldRetry ?? 0} failed job(s) back in the queue`
                : `${Object.entries(outcome.result.counts).map(([k, n]) => `${n} ${k}`).join(' · ') || 'nothing to plan'}${outcome.result.dryRun ? ' (dry run — nothing enqueued)' : ` · ${outcome.result.enqueued} enqueued`}`}
        </p>
      )}

      {status && status.recent.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-secondary">Last {status.recent.length} jobs</summary>
          <ul className="mt-2 space-y-1 font-mono text-xs text-secondary">
            {status.recent.map(j => (
              <li key={j.id}>
                {j.status} · {j.kind} · {j.target_table} · attempts {j.attempts}{j.error ? ` · ${j.error.slice(0, 80)}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmModal
        isOpen={confirm !== null}
        title={confirm === 'plan' ? 'Enqueue the backfill?' : confirm === 'retry' ? 'Retry every failed job?' : 'Run a tick now?'}
        message={
          confirm === 'plan'
            ? 'Older media that need a poster, a blur or a conversion get a job each. Old posts stay playable where they are; the swap arrives silently.'
            : confirm === 'retry'
              ? 'Every failed job goes back to the queue with its attempts reset.'
              : 'Claims due jobs and runs them in this request — a conversion can take minutes.'
        }
        confirmText={confirm === 'plan' ? 'Enqueue' : confirm === 'retry' ? 'Retry' : 'Run'}
        confirmButtonClass="bg-brand hover:bg-brand-strong"
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) void run(c); }}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
