'use client';

import { useEffect, useState } from 'react';
import { SUGGESTION_AREAS, SUGGESTION_AREA_LABELS, TICKET_LIMITS, type SuggestionArea } from '@/lib/tickets/types';

/**
 * Suggest a feature (Support & Reporting, Spec 4 — the doc): area, a
 * one-line title, a description, and "OK to contact me about this". Files a
 * `suggestion` ticket (Low severity — the weekly review). The email is the
 * account's; the checkbox only governs FOLLOW-UP mail (the shipped note),
 * never ticket status mail. Signed-in only: a suggestion needs an account.
 */
const DONE_MS = 6000;

export default function SuggestForm({ onCreated }: { onCreated?: () => void }) {
  const [area, setArea] = useState<SuggestionArea>('feed');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [contactOk, setContactOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), DONE_MS);
    return () => clearTimeout(t);
  }, [done]);

  const submit = async () => {
    if (!title.trim() || !description.trim()) { setError('Give it a title and a line or two.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'suggestion', reason: area, subject: title.trim(), description: description.trim(), contact_ok: contactOk }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not send your idea. Try again.'); return; }
      setDone(data.number);
      setTitle('');
      setDescription('');
      onCreated?.();
    } catch {
      setError('Could not send your idea. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="help-suggest-heading" data-suggest-form="">
      <h2 id="help-suggest-heading" className="text-lg font-semibold text-primary mb-1">Suggest a feature</h2>
      <p className="text-sm text-tertiary mb-4">Ideas go into a weekly review. If yours ships, you hear about it.</p>
      {done && (
        <p role="status" className="mb-4 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 px-4 py-3 text-sm text-green-800 dark:text-green-300" data-suggest-created={done}>
          Thanks — your idea is <strong>{done}</strong>. It joins the weekly review.
        </p>
      )}
      <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label className="text-sm text-secondary">
          Where does it belong?
          <select value={area} onChange={e => setArea(e.target.value as SuggestionArea)} className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary">
            {SUGGESTION_AREAS.map(a => <option key={a} value={a}>{SUGGESTION_AREA_LABELS[a]}</option>)}
          </select>
        </label>
        <label className="text-sm text-secondary">
          In one line
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={TICKET_LIMITS.subject} required className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary" data-suggest-title="" />
        </label>
        <label className="text-sm text-secondary">
          Tell us more
          <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={TICKET_LIMITS.description} rows={4} required className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary" data-suggest-description="" />
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-secondary">
          <input type="checkbox" checked={contactOk} onChange={e => setContactOk(e.target.checked)} data-suggest-contact-ok="" />
          OK to contact me about this
        </label>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div>
          <button type="submit" disabled={busy} className="px-4 py-2 min-h-[44px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition disabled:opacity-50" data-suggest-submit="">
            {busy ? 'Sending…' : 'Send idea'}
          </button>
        </div>
      </form>
    </section>
  );
}
