'use client';

import { useState } from 'react';
import { TICKET_LIMITS } from '@/lib/tickets/types';

/**
 * "Recover a club, league or event" (Authority PR 5, Sep 25 2026). Tom: "Even
 * if there isn't a contact, we need a way to recover and for users to manage
 * the site if something were to happen or if someone is being malicious."
 * A Help ticket with reason `recovery` (severity high) — signed in through
 * POST /api/tickets, signed out through the guest route (someone locked out
 * of their own account can still ask). The link or name rides as `reference`;
 * the server matches it silently and answers the same way whatever it finds.
 * The answers become the ticket's words, in a fixed order the team reads.
 */
const ROLES = [
  ['owner', 'I own or run it'],
  ['manager', 'I help run it (manager, co-organizer, staff)'],
  ['member', 'I’m a member or player'],
  ['other', 'Something else'],
] as const;
const WHAT = [
  ['lost_access', 'I lost access to the account that runs it'],
  ['owner_gone', 'The person who runs it left or can’t be reached'],
  ['misuse', 'Someone is misusing it (vandalism, removing people)'],
  ['other', 'Something else'],
] as const;

export default function RecoverForm({ signedIn, onCreated }: { signedIn: boolean; onCreated?: () => void }) {
  const [reference, setReference] = useState('');
  const [role, setRole] = useState<string>('owner');
  const [what, setWhat] = useState<string>('lost_access');
  const [who, setWho] = useState('');
  const [details, setDetails] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const words = [
      `My role: ${ROLES.find(r => r[0] === role)?.[1] ?? role}`,
      `What happened: ${WHAT.find(w => w[0] === what)?.[1] ?? what}`,
      who.trim() ? `Who should run it: ${who.trim()}` : null,
      '',
      details.trim(),
    ].filter(l => l !== null).join('\n').slice(0, TICKET_LIMITS.description - 600);
    const common = { reason: 'recovery', subject: 'Recover a club, league or event', description: words, reference: reference.trim() };
    try {
      const res = signedIn
        ? await fetch('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'help', ...common }) })
        : await fetch('/api/tickets/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...common, email: email.trim(), website }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not send your request. Try again.'); return; }
      setDone(String(data.number ?? ''));
      onCreated?.();
    } catch {
      setError('Could not send your request. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p role="status" className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 px-4 py-3 text-sm text-green-800 dark:text-green-300" data-recover-created={done}>
        Sent — your ticket is <strong>{done}</strong>. We’ll verify who you are before changing anything{signedIn ? ', and reply under My requests.' : `, and reply to ${email.trim()}.`}
      </p>
    );
  }

  const field = 'mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary';
  return (
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void submit(); }} data-recover-form="">
      <label className="text-sm text-secondary">
        The club, league or event — a link, its website, or its name
        <input required value={reference} onChange={e => setReference(e.target.value)} maxLength={500} placeholder="https://… or Pine Valley Golf Club" className={field} data-recover-reference="" />
      </label>
      <label className="text-sm text-secondary">
        Your role
        <select value={role} onChange={e => setRole(e.target.value)} className={field}>
          {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="text-sm text-secondary">
        What happened
        <select value={what} onChange={e => setWhat(e.target.value)} className={field} data-recover-what="">
          {WHAT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="text-sm text-secondary">
        Who should run it now <span className="text-muted">(optional — a name, handle or email)</span>
        <input value={who} onChange={e => setWho(e.target.value)} maxLength={200} className={field} />
      </label>
      <label className="text-sm text-secondary">
        Anything that shows it’s yours — dates, other people who run it, what changed
        <textarea required value={details} onChange={e => setDetails(e.target.value)} maxLength={2000} rows={4} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary" data-recover-details="" />
      </label>
      {!signedIn && (
        <label className="text-sm text-secondary">
          Your email (we reply here)
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className={field} data-recover-email="" />
        </label>
      )}
      {!signedIn && (
        <div aria-hidden="true" className="absolute -left-[9999px] top-auto w-px h-px overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
          </label>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div>
        <button type="submit" disabled={busy} className="px-4 py-2 min-h-[44px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition disabled:opacity-50" data-recover-submit="">
          {busy ? 'Sending…' : 'Ask for help'}
        </button>
      </div>
    </form>
  );
}
