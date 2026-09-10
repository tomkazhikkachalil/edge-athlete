'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { RECRUITING_STATUS_LABEL, gradYearLabel } from '@/lib/recruiting/profile';
import type { ShortlistAthlete } from '@/lib/recruiting/shortlist';
import ShortlistNoteModal from './ShortlistNoteModal';

// ── The scout's shortlist (R3) — cards below sm, a table from sm up ───────

export default function ScoutShortlist() {
  const { showError, showSuccess } = useToast();
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [items, setItems] = useState<ShortlistAthlete[]>([]);
  const [noteFor, setNoteFor] = useState<ShortlistAthlete | null>(null);
  const [removeFor, setRemoveFor] = useState<ShortlistAthlete | null>(null);

  // A retry bumps the key; the effect owns the fetch (no synchronous
  // setState in the effect body — react-hooks/set-state-in-effect).
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/scout/shortlist', { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setState('error');
          return;
        }
        const data = (await res.json()) as { supported: boolean; items: ShortlistAthlete[] };
        if (cancelled) return;
        setItems(data.items ?? []);
        setState(data.supported ? 'ready' : 'unsupported');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const saveNote = async (athleteId: string, note: string) => {
    const res = await fetch(`/api/scout/shortlist/${athleteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showError('Note', err.error || 'Could not save the note');
      throw new Error('note');
    }
    const saved = (await res.json()) as { note: string | null };
    setItems(prev => prev.map(i => (i.athleteId === athleteId ? { ...i, note: saved.note } : i)));
    showSuccess('Note saved', 'Only you can see it.');
  };

  const remove = async (athleteId: string) => {
    const res = await fetch(`/api/scout/shortlist/${athleteId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showError('Shortlist', err.error || 'Could not remove');
      return;
    }
    setItems(prev => prev.filter(i => i.athleteId !== athleteId));
  };

  if (state === 'loading') {
    return <p className="text-sm text-muted" aria-busy="true">Loading your shortlist…</p>;
  }
  if (state === 'unsupported') {
    return <p className="text-sm text-tertiary">Shortlists need a database migration first (183).</p>;
  }
  if (state === 'error') {
    return (
      <p className="text-sm text-tertiary">
        Could not load your shortlist.{' '}
        <button type="button" onClick={load} className="text-brand-fg font-medium min-h-[44px]">Try again</button>
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-tertiary" data-shortlist-empty="">
        Athletes you shortlist from their profiles collect here. Find recruitable athletes on{' '}
        <Link href="/explore" className="text-brand-fg hover:text-brand-fg-strong font-medium">Explore</Link>
        {' '}— open profiles show a Recruiting card with a Shortlist button.
      </p>
    );
  }

  const row = (a: ShortlistAthlete) => ({
    name: (
      <Link href={`/athlete/${a.athleteId}`} className="font-medium text-primary hover:text-brand-fg">
        {a.name}
      </Link>
    ),
    facts: [a.sport, a.school, gradYearLabel(a.gradYear)].filter(Boolean).join(' · '),
    status: RECRUITING_STATUS_LABEL[a.recruitingStatus],
  });

  return (
    <>
      {/* Phone: cards */}
      <ul className="space-y-3 sm:hidden" data-shortlist-cards={items.length}>
        {items.map(a => {
          const r = row(a);
          return (
            <li key={a.athleteId} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate">{r.name}</p>
                  {r.facts && <p className="text-xs text-tertiary truncate">{r.facts}</p>}
                  <p className="text-xs text-muted">{r.status}</p>
                </div>
              </div>
              {a.note && <p className="mt-2 text-sm text-secondary whitespace-pre-line">{a.note}</p>}
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setNoteFor(a)} className="min-h-[44px] px-3 rounded-lg border border-border-strong text-sm font-medium text-secondary">
                  {a.note ? 'Edit note' : 'Add note'}
                </button>
                <button type="button" onClick={() => setRemoveFor(a)} className="min-h-[44px] px-3 rounded-lg text-sm font-medium text-red-700 dark:text-red-300">
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {/* Tablet and up: a table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="min-w-full text-sm" data-shortlist-rows={items.length}>
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="py-2 pr-3 font-medium">Athlete</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Note</th>
              <th className="py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(a => {
              const r = row(a);
              return (
                <tr key={a.athleteId} className="border-b border-border-subtle last:border-0 align-top">
                  <td className="py-2 pr-3">
                    {r.name}
                    {r.facts && <p className="text-xs text-tertiary">{r.facts}</p>}
                  </td>
                  <td className="py-2 pr-3 text-secondary whitespace-nowrap">{r.status}</td>
                  <td className="py-2 pr-3 text-secondary max-w-md">
                    {a.note ? <span className="whitespace-pre-line">{a.note}</span> : <span className="text-muted">—</span>}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button type="button" onClick={() => setNoteFor(a)} className="min-h-[36px] px-2 text-brand-fg hover:text-brand-fg-strong font-medium">
                      {a.note ? 'Edit note' : 'Add note'}
                    </button>
                    <button type="button" onClick={() => setRemoveFor(a)} className="min-h-[36px] px-2 text-red-700 dark:text-red-300 font-medium">
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {noteFor && (
        <ShortlistNoteModal
          athleteName={noteFor.name}
          initialNote={noteFor.note}
          onSave={note => saveNote(noteFor.athleteId, note)}
          onClose={() => setNoteFor(null)}
        />
      )}
      <ConfirmModal
        isOpen={!!removeFor}
        title="Remove from your shortlist?"
        message={removeFor ? `${removeFor.name} and your note will be removed.` : ''}
        confirmText="Remove"
        cancelText="Keep"
        onConfirm={() => {
          const target = removeFor;
          setRemoveFor(null);
          if (target) void remove(target.athleteId);
        }}
        onCancel={() => setRemoveFor(null)}
      />
    </>
  );
}
