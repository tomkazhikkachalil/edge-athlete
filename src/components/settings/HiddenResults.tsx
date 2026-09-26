'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ── Hidden from your profile — results-kept round (241) ────────────────────
// Tom: "The user can have their profile viewed as they would like. However,
// any data metrics recorded will go towards understanding what the athlete's
// athletic score is." So nothing a person records is deleted — it can be
// hidden from their profile, and it comes back from here. Rounds and result
// posts (event results, stat lines, a round's post), newest hidden first.

interface Hidden {
  rounds: Array<{ id: string; date: string; course: string | null; gross_score: number | null; hidden_at: string }>;
  posts: Array<{ id: string; caption: string | null; sport_key: string | null; created_at: string; hidden_at: string }>;
}

export default function HiddenResults() {
  const [data, setData] = useState<Hidden | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Hidden | null> => {
    try {
      const res = await fetch('/api/results/visibility', { cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()) as Hidden;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = await load();
      if (cancelled) return;
      if (!out) { setStatus('error'); return; }
      setData(out);
      setStatus('ready');
    })();
    return () => { cancelled = true; };
  }, [load]);

  const show = async (kind: 'post' | 'golf_round', id: string) => {
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch('/api/results/visibility', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id, hidden: false }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(typeof body.error === 'string' ? body.error : 'Could not show it. Try again.'); return; }
      setMessage('Back on your profile.');
      const out = await load();
      if (out) setData(out);
    } finally {
      setBusy(null);
    }
  };

  const empty = data && data.rounds.length === 0 && data.posts.length === 0;
  const row = 'flex flex-col sm:flex-row sm:items-center gap-2 py-3';
  const btn = 'px-3 py-2 min-h-[44px] rounded-lg border border-border bg-surface text-sm font-semibold text-primary ea-interactive disabled:opacity-50';

  return (
    <section className="ea-surface rounded-lg p-4 sm:p-6 mt-6" aria-labelledby="hidden-results-title" data-hidden-results="">
      <h2 id="hidden-results-title" className="text-lg font-semibold text-primary">Hidden from your profile</h2>
      <p className="text-sm text-tertiary mt-1 mb-3">
        Results you hid stay on the record — they still count toward your stats and handicap — but nobody else sees them on your profile. Show any of them again here.
      </p>
      {status === 'loading' && <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand"></div>}
      {status === 'error' && <p role="alert" className="text-sm text-tertiary">Couldn&apos;t load your hidden results.</p>}
      {message && <p role="status" className="text-sm text-secondary mb-2" data-hidden-results-message="">{message}</p>}
      {empty && <p className="text-sm text-tertiary">Nothing hidden.</p>}
      {data && !empty && (
        <ul className="divide-y divide-border">
          {data.rounds.map(r => (
            <li key={r.id} className={row} data-hidden-round={r.id}>
              <span className="flex-1 min-w-0 text-sm text-primary break-words">
                <Link href={`/app/sport/golf/rounds/${r.id}`} className="font-medium hover:underline">{r.course ?? 'Golf round'}</Link>
                <span className="text-muted"> · {new Date(`${r.date}T00:00:00`).toLocaleDateString()}{r.gross_score != null ? ` · ${r.gross_score}` : ''}</span>
              </span>
              <button type="button" className={btn} disabled={busy !== null} onClick={() => void show('golf_round', r.id)} data-show-result={r.id}>
                {busy === r.id ? 'Showing…' : 'Show again'}
              </button>
            </li>
          ))}
          {data.posts.map(p => (
            <li key={p.id} className={row} data-hidden-post={p.id}>
              <span className="flex-1 min-w-0 text-sm text-primary break-words">
                {p.caption?.trim() ? p.caption.slice(0, 120) : 'A result'}
                <span className="text-muted"> · {new Date(p.created_at).toLocaleDateString()}</span>
              </span>
              <button type="button" className={btn} disabled={busy !== null} onClick={() => void show('post', p.id)} data-show-result={p.id}>
                {busy === p.id ? 'Showing…' : 'Show again'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
