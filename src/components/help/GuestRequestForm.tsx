'use client';

import { useState } from 'react';
import { HELP_CATEGORIES, HELP_CATEGORY_LABELS, TICKET_LIMITS, type HelpCategory } from '@/lib/tickets/types';

/**
 * The signed-out Help request (Spec 3): email, category, subject, what
 * happened → POST /api/tickets/guest. The honeypot is a visually-hidden
 * "website" field a person never fills. The done state shows the number
 * and says the replies go to the email.
 */
export default function GuestRequestForm() {
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState<HelpCategory>('account');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tickets/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), reason: category, subject: subject.trim() || undefined, description: description.trim(), website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not send your request. Try again.'); return; }
      setDone(data.number);
    } catch {
      setError('Could not send your request. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p role="status" className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 px-4 py-3 text-sm text-green-800 dark:text-green-300" data-guest-created={done}>
        Sent — your ticket is <strong>{done}</strong>. We reply to {email.trim()} within 2 business days.
      </p>
    );
  }

  return (
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void submit(); }} data-guest-form="">
      <label className="text-sm text-secondary">
        Your email
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary" />
      </label>
      <label className="text-sm text-secondary">
        What is it about?
        <select value={category} onChange={e => setCategory(e.target.value as HelpCategory)} className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary">
          {HELP_CATEGORIES.map(c => <option key={c} value={c}>{HELP_CATEGORY_LABELS[c]}</option>)}
        </select>
      </label>
      <label className="text-sm text-secondary">
        Subject <span className="text-muted">(optional)</span>
        <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={TICKET_LIMITS.subject} className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary" />
      </label>
      <label className="text-sm text-secondary">
        What happened?
        <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={TICKET_LIMITS.description} rows={4} required className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary" />
      </label>
      {/* The honeypot: off-screen, never tab-reachable; a bot fills it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto w-px h-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div>
        <button type="submit" disabled={busy} className="px-4 py-2 min-h-[44px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition disabled:opacity-50" data-guest-submit="">
          {busy ? 'Sending…' : 'Send request'}
        </button>
      </div>
    </form>
  );
}
