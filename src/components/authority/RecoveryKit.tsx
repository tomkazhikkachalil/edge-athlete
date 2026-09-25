'use client';

import { useCallback, useState, type ReactNode } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { RECOVERY_NOTE_MAX } from '@/lib/authority/recovery';
export { actionWords } from '@/lib/authority/words';

// ── The recovery panels' shared kit (Authority PR 4) ────────────────────────
// Every act the Edge Athlete team takes names an open ticket and says why
// (the note lands in the authority log and the ticket's history). The bar
// holds both; nothing can be done until both are filled. Every act asks
// first (ConfirmModal) — these change who can run someone else's org.

export interface PendingAct {
  title: string;
  message: string;
  confirmText: string;
  body: Record<string, unknown>;
  /** Called with the response body after a successful act (the recovery link's URL). */
  onDone?: (data: Record<string, unknown>) => void;
}

export function useRecoveryAct(endpoint: string, initialTicket: string, reload: () => Promise<void>) {
  const [ticket, setTicket] = useState(initialTicket);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAct | null>(null);

  const ready = ticket.trim().length > 0 && note.trim().length > 0;

  const ask = useCallback((act: PendingAct) => {
    setError(null);
    setDone(null);
    setPending(act);
  }, []);

  const confirm = async () => {
    const act = pending;
    setPending(null);
    if (!act) return;
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...act.body, ticket: ticket.trim(), note: note.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'That did not work. Try again.');
        return;
      }
      act.onDone?.(data);
      setDone(act.title.replace(/\?$/, '') + ' — done.');
      await reload();
    } catch {
      setError('That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const bar = (
    <section className="ea-surface rounded-lg p-4 mb-4 grid gap-3 sm:grid-cols-[10rem_1fr]" aria-label="Ticket and reason" data-recovery-bar="">
      <label className="text-xs text-muted">
        Support ticket
        <input
          value={ticket}
          onChange={e => setTicket(e.target.value)}
          placeholder="EA-1042"
          className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary font-mono"
          data-recovery-ticket=""
        />
      </label>
      <label className="text-xs text-muted">
        Why (recorded in the log and on the ticket)
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={RECOVERY_NOTE_MAX}
          placeholder="Verified the requester is the club secretary; the owner left in 2025"
          className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary"
          data-recovery-note=""
        />
      </label>
      {!ready && <p className="sm:col-span-2 text-xs text-muted">Name the ticket and the reason to enable the actions below.</p>}
      {error && <p role="alert" className="sm:col-span-2 text-sm text-red-700 dark:text-red-300" data-recovery-error="">{error}</p>}
      {done && <p role="status" className="sm:col-span-2 text-sm text-emerald-700 dark:text-emerald-300" data-recovery-done="">{done}</p>}
    </section>
  );

  const modal = (
    <ConfirmModal
      isOpen={pending !== null}
      title={pending?.title ?? ''}
      message={pending?.message ?? ''}
      confirmText={pending?.confirmText ?? 'Confirm'}
      onConfirm={confirm}
      onCancel={() => setPending(null)}
    />
  );

  return { ticket, note, ready, busy, ask, bar, modal };
}

export function RecoverySection({ title, children, label }: { title: string; children: ReactNode; label?: string }) {
  return (
    <section className="ea-surface rounded-lg p-4 mb-4" aria-label={label ?? title}>
      <h2 className="text-sm font-semibold text-primary mb-3">{title}</h2>
      {children}
    </section>
  );
}

export const actButton = 'px-3 py-2 min-h-[44px] rounded-lg border border-border bg-surface text-sm font-semibold text-primary ea-interactive disabled:opacity-50';
export const dangerButton = 'px-3 py-2 min-h-[44px] rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition disabled:opacity-50';
export const fieldClass = 'min-h-[44px] w-full rounded-lg border border-border bg-surface px-3 text-sm text-primary';

/** A person's badges — what makes them fit (or not) to run something. */
export function PersonBadges({ person }: { person: { supervised: boolean; departed: boolean; moderation: string; holds: boolean } | null }) {
  if (!person) return <span className="text-xs text-muted">Deleted account</span>;
  const chips: string[] = [];
  if (person.departed) chips.push('Deleted');
  if (person.supervised) chips.push('Supervised');
  if (person.moderation !== 'active') chips.push(person.moderation);
  if (chips.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {chips.map(c => (
        <span key={c} className="rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 px-2 py-0.5 text-xs font-semibold">{c}</span>
      ))}
    </span>
  );
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
