'use client';

import { useState } from 'react';

// The official-sheet backfill's door (Oct 31 2026): small batches by place.
// Preview shows the matches and writes nothing; Fill writes after that review.

interface Row { id: string; name: string; source: string; outcome: string; match: { name: string; city: string | null } | null; holes: number }
interface Answer { dryRun: boolean; asked: number; matched: number; stopped: string | null; results: Row[] }

export default function GolfSheetBackfillPanel() {
  const [country, setCountry] = useState('CA');
  const [region, setRegion] = useState('ON');
  const [limit, setLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/golf-sheet-backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ countryCode: country, regionCode: region || undefined, limit, dryRun }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Batch failed');
      setAnswer(body as Answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Batch failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-sheet-backfill="">
      <h2 className="text-lg font-semibold text-primary">Course scorecards backfill</h2>
      <p className="mt-1 text-sm text-tertiary">Preview a small batch, read the matches, then fill it. Preview writes nothing.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm text-secondary">Country
          <input value={country} onChange={e => setCountry(e.target.value)} className="mt-1 block w-20 rounded-md border border-border-strong bg-surface px-2 py-2 text-primary" />
        </label>
        <label className="text-sm text-secondary">Region
          <input value={region} onChange={e => setRegion(e.target.value)} className="mt-1 block w-20 rounded-md border border-border-strong bg-surface px-2 py-2 text-primary" />
        </label>
        <label className="text-sm text-secondary">Courses
          <input type="number" min={1} max={25} value={limit} onChange={e => setLimit(Number(e.target.value))} className="mt-1 block w-20 rounded-md border border-border-strong bg-surface px-2 py-2 text-primary" />
        </label>
        <button type="button" disabled={busy} onClick={() => void run(true)} data-sheet-backfill-preview="" className="ea-interactive min-h-[44px] rounded-lg border border-border-strong px-4 text-sm font-semibold text-primary disabled:opacity-50">{busy ? 'Working…' : 'Preview batch'}</button>
        <button type="button" disabled={busy || !answer?.dryRun || answer.matched === 0} onClick={() => void run(false)} data-sheet-backfill-fill="" className="ea-cta min-h-[44px] rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50">Fill this batch</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
      {answer && (
        <div className="mt-3 text-sm" data-sheet-backfill-result="">
          <p className="font-semibold text-primary">{answer.dryRun ? 'Preview' : 'Filled'}: {answer.matched} matched of {answer.asked}{answer.stopped ? ` (stopped: ${answer.stopped})` : ''}</p>
          <ul className="mt-2 divide-y divide-border-subtle">
            {answer.results.map(r => (
              <li key={r.id} className="py-1.5 text-secondary">
                <span className="font-medium text-primary">{r.name}</span> · {r.match ? `→ ${r.match.name}${r.match.city ? ` (${r.match.city})` : ''}` : r.outcome.replace(/_/g, ' ')}{!answer.dryRun && r.holes > 0 ? ` · ${r.holes} holes` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
