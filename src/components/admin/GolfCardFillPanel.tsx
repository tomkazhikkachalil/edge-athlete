'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import type { CardFillProgress, CardFillSummary, CardLinkSummary } from '@/lib/golf/card-fill-server';

// ── The scorecard fill's door (Nov 17 2026, migration 314) ──────────────────
// `/api/admin/golf-card-fill` is dry-run by default. The schedule (the map
// sweep's tick) links courses to OpenGolfAPI once a month and fills a few
// cards every two minutes inside the day's cap; this panel reads the progress
// and runs either step by hand.

type Step = 'link' | 'cards';
type Result = CardLinkSummary | CardFillSummary;

const btn = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';

/** One line for a step's answer, in its own numbers. */
export function describeCardFill(r: Result): string {
  const dry = r.dryRun ? ' (dry run, nothing written)' : '';
  if (r.phase === 'link') {
    return `${r.matched} of ${r.ours} unlinked US courses matched in ${r.dataset} OpenGolfAPI courses${r.dryRun ? '' : ` · ${r.linked} linked`} · ${r.ambiguous} ambiguous · ${r.unmatched} no match${dry}`;
  }
  const outcomes = Object.entries(r.outcomes).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ');
  return `${r.due} due${outcomes ? ` · ${outcomes}` : ''}${r.budgetExhausted ? ' · today’s cap is spent' : ''}${dry}`;
}

async function readProgress(): Promise<{ progress: CardFillProgress | null; error: string | null }> {
  try {
    const res = await fetch('/api/admin/golf-card-fill', { cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as CardFillProgress | { error?: string };
    if (!res.ok || !('ok' in json)) return { progress: null, error: ('error' in json && json.error) || `HTTP ${res.status}` };
    return { progress: json, error: null };
  } catch (e) {
    return { progress: null, error: e instanceof Error ? e.message : 'failed' };
  }
}

export default function GolfCardFillPanel() {
  const [progress, setProgress] = useState<CardFillProgress | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Step | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; failed: boolean } | null>(null);

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

  const run = async (phase: Step, dryRun: boolean) => {
    setBusy(`${phase}-${dryRun ? 'dry' : 'live'}`);
    try {
      const res = await fetch('/api/admin/golf-card-fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase, dryRun, rows: 10 }),
      });
      const json = (await res.json().catch(() => ({}))) as Result | { error?: string };
      if (!res.ok || !('phase' in json)) throw new Error(('error' in json && json.error) || `HTTP ${res.status}`);
      setOutcome({ text: describeCardFill(json), failed: false });
    } catch (e) {
      setOutcome({ text: e instanceof Error ? e.message : 'failed', failed: true });
    } finally {
      setBusy(null);
      const r = await readProgress();
      setProgress(r.progress);
      setProgressError(r.error);
    }
  };

  const linkAt = progress?.link && typeof progress.link === 'object' && 'at' in progress.link ? String((progress.link as { at: unknown }).at).slice(0, 10) : null;

  return (
    <section aria-label="Scorecard fill" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-admin-golf-card-fill="">
      <h2 className="text-lg font-semibold text-primary mb-1">Scorecard fill</h2>
      <p className="text-xs text-muted mb-3">
        Fills US courses&apos; scorecards in the background from OpenGolfAPI (open data, ODbL): each course is linked to its entry by name and
        distance, then its card is fetched once, checked against its own totals and the map, and saved. A card that fails a check is refused
        with its reason. Other countries get their card when someone picks the course. A dry run writes nothing.
      </p>

      {progressError ? (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3" data-card-fill-progress-error="">
          {progressError.includes('314') ? 'Migration 314 has not run on this database yet.' : `Progress unavailable: ${progressError}`}
        </p>
      ) : progress ? (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm mb-4" data-card-fill-progress="">
          <div>
            <dt className="text-xs text-muted">Courses with a card</dt>
            <dd className="font-medium text-primary" data-card-fill-with-card="">{progress.withCard} of {progress.courses}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Linked to OpenGolfAPI</dt>
            <dd className="font-medium text-primary" data-card-fill-linked="">
              {progress.linked}
              <span className="block text-xs text-muted font-normal">{linkAt ? `last linked ${linkAt}` : 'never linked'}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Filled · waiting</dt>
            <dd className="font-medium text-primary" data-card-fill-filled="">{progress.filled} filled · {progress.waiting} waiting</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Refused · today</dt>
            <dd className="font-medium text-primary" data-card-fill-refused="">
              {progress.refused} refused
              <span className="block text-xs text-muted font-normal">{progress.budget ? `${progress.budget.count} asked today` : 'none asked today'}</span>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-xs text-muted mb-3">Loading…</p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-3">
        <button type="button" disabled={!!busy} onClick={() => run('link', true)} className={btn} data-card-fill-link-dry="">
          {busy === 'link-dry' ? 'Reading…' : 'Dry run the link'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => setConfirm('link')} className={btn} data-card-fill-link="">
          {busy === 'link-live' ? 'Linking…' : 'Link courses'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => run('cards', true)} className={btn} data-card-fill-cards-dry="">
          {busy === 'cards-dry' ? 'Reading…' : 'Dry run a batch'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => setConfirm('cards')} className={btn} data-card-fill-cards="">
          {busy === 'cards-live' ? 'Filling…' : 'Fill a batch'}
        </button>
      </div>

      {outcome && (
        <p className={`text-xs mt-3 min-w-0 break-words ${outcome.failed ? 'text-red-600 dark:text-red-400' : 'text-muted'}`} data-card-fill-outcome="">
          {outcome.failed ? `Failed: ${outcome.text}` : outcome.text}
        </p>
      )}

      <ConfirmModal
        isOpen={confirm === 'link'}
        title="Link courses to OpenGolfAPI?"
        message="Reads OpenGolfAPI's published file and records, on each US course it matches by name and distance, which entry it is. No scorecard changes; a course with two possible matches is left unlinked."
        confirmText="Link courses"
        onConfirm={() => { setConfirm(null); void run('link', false); }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmModal
        isOpen={confirm === 'cards'}
        title="Fill a batch of scorecards?"
        message="Asks OpenGolfAPI for up to ten linked courses' cards and saves each one that passes its checks. A course that already has a card is never touched."
        confirmText="Fill a batch"
        onConfirm={() => { setConfirm(null); void run('cards', false); }}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
