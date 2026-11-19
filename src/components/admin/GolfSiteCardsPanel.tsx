'use client';

import { useEffect, useState } from 'react';
import type { SiteCardProgress, SiteCardSummary } from '@/lib/golf/site-card-server';

// ── The website scorecard reader's door (Nov 18 2026, migration 315) ────────
// `/api/admin/golf-site-cards` is dry-run by default. The schedule visits two
// courses' own websites every five minutes; this panel reads what the visits
// came to, lists the last cards saved with where each was read (so any one
// can be checked against its source), and dry-runs a step by hand.

type Ok = Extract<SiteCardProgress, { ok: true }>;

const btn = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';

const WORDS: Record<string, string> = {
  ok: 'saved', no_card: 'no scorecard on the site', picture_only: 'scorecard is a picture (not read)', unreachable: 'site did not answer', robots: 'site asks not to be read',
  no_site: 'no usable website', several_cards: 'several courses on one sheet', name_unconfirmed: 'could not confirm whose card', name_mismatch: 'another course’s card',
  sum_mismatch: 'totals do not add up', yardage_disagrees: 'hole lengths do not fit the map', map_disagrees: 'pars do not fit the map', hole_count: 'wrong number of holes',
  par_sum: 'pars do not add up', no_yardage: 'no yardage', taken: 'a card arrived meanwhile',
};
export const siteOutcomeWords = (k: string) => WORDS[k] ?? k.replace(/_/g, ' ');

/** One line for a step's answer. */
export function describeSiteCards(r: SiteCardSummary): string {
  const outcomes = Object.entries(r.outcomes).map(([k, v]) => `${v} ${siteOutcomeWords(k)}`).join(', ');
  return `${r.due} due${outcomes ? ` · ${outcomes}` : ''}${r.budgetExhausted ? ' · today’s cap is spent' : ''}${r.dryRun ? ' (dry run, nothing written)' : ''}`;
}

async function readProgress(): Promise<{ progress: Ok | null; error: string | null }> {
  try {
    const res = await fetch('/api/admin/golf-site-cards', { cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as SiteCardProgress | { error?: string };
    if (!res.ok || !('ok' in json) || !json.ok) return { progress: null, error: ('error' in json && json.error) || `HTTP ${res.status}` };
    return { progress: json, error: null };
  } catch (e) {
    return { progress: null, error: e instanceof Error ? e.message : 'failed' };
  }
}

export default function GolfSiteCardsPanel() {
  const [progress, setProgress] = useState<Ok | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const dryRun = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/golf-site-cards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: 2 }) });
      const json = (await res.json().catch(() => ({}))) as SiteCardSummary | { error?: string };
      if (!res.ok || !('phase' in json)) throw new Error(('error' in json && json.error) || `HTTP ${res.status}`);
      setOutcome({ text: describeSiteCards(json), failed: false });
    } catch (e) {
      setOutcome({ text: e instanceof Error ? e.message : 'failed', failed: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Website scorecards" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-admin-golf-site-cards="">
      <h2 className="text-lg font-semibold text-primary mb-1">Website scorecards</h2>
      <p className="text-xs text-muted mb-3">
        Visits each course&apos;s own website once and reads a scorecard it publishes as text (a table on a page, or a PDF with text). A card is saved
        only when it adds up to its own printed totals, is that course&apos;s, and fits the map. A scorecard published as a picture is not read. Free:
        no outside service is called.
      </p>

      {progressError ? (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3" data-site-cards-progress-error="">
          {progressError.includes('315') ? 'Migration 315 has not run on this database yet.' : `Progress unavailable: ${progressError}`}
        </p>
      ) : progress ? (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm mb-3" data-site-cards-progress="">
            <div>
              <dt className="text-xs text-muted">Cards saved</dt>
              <dd className="font-medium text-primary" data-site-cards-saved="">{progress.outcomes.ok ?? 0}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Sites visited</dt>
              <dd className="font-medium text-primary" data-site-cards-visited="">{progress.visited}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Still to visit</dt>
              <dd className="font-medium text-primary" data-site-cards-waiting="">{progress.waiting}</dd>
            </div>
          </dl>
          {Object.keys(progress.outcomes).length > 0 && (
            <ul className="text-xs text-secondary mb-3 space-y-0.5" data-site-cards-outcomes="">
              {Object.entries(progress.outcomes).map(([k, v]) => (
                <li key={k}>{v} · {siteOutcomeWords(k)}</li>
              ))}
            </ul>
          )}
          {progress.saved.length > 0 && (
            <ul className="text-xs mb-3 space-y-1 min-w-0" data-site-cards-list="">
              {progress.saved.map(s => (
                <li key={s.id} className="min-w-0 break-words">
                  <span className="text-primary font-medium">{s.name}</span>
                  {s.url && (
                    <>
                      {' · '}
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-fg-strong underline break-all">source</a>
                    </>
                  )}
                  {s.at && <span className="text-muted"> · {s.at.slice(0, 10)}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-xs text-muted mb-3">Loading…</p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-3">
        <button type="button" disabled={busy} onClick={dryRun} className={btn} data-site-cards-dry="">
          {busy ? 'Visiting…' : 'Dry run two sites'}
        </button>
      </div>

      {outcome && (
        <p className={`text-xs mt-3 min-w-0 break-words ${outcome.failed ? 'text-red-600 dark:text-red-400' : 'text-muted'}`} data-site-cards-outcome="">
          {outcome.failed ? `Failed: ${outcome.text}` : outcome.text}
        </p>
      )}
    </section>
  );
}
