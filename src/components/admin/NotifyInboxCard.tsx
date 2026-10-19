'use client';

import { useEffect, useState } from 'react';

type Inbox = { value: string | null; source: 'setting' | 'env' | 'none' };

/**
 * The notify-inbox setting (266): where every sign-up and inquiry is
 * mailed. Shows the effective address and where it came from, saves a new
 * one through PUT /api/admin/settings (the setting wins over the env),
 * "Use the env default" clears it, and "Send a test email" proves the pipe
 * with an honest answer when it cannot send.
 */
export default function NotifyInboxCard() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [smtp, setSmtp] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'save' | 'clear' | 'test' | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  // Inlined cancellable IIFE (the house pattern): the card's first read.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/settings', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { notifyInbox: Inbox; smtpConfigured: boolean };
        if (cancelled) return;
        setInbox(data.notifyInbox);
        setSmtp(data.smtpConfigured);
        setDraft(data.notifyInbox.source === 'setting' ? data.notifyInbox.value ?? '' : '');
      } catch {
        /* the card still renders; the note says nothing until an action */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const put = async (value: string | null) => {
    setBusy(value === null ? 'clear' : 'save');
    setNote(null);
    try {
      const res = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'notify_inbox_email', value }) });
      const data = (await res.json().catch(() => ({}))) as { notifyInbox?: Inbox; error?: string };
      if (!res.ok || !data.notifyInbox) { setNote({ tone: 'warn', text: data.error ?? 'Could not save.' }); return; }
      setInbox(data.notifyInbox);
      setDraft(data.notifyInbox.source === 'setting' ? data.notifyInbox.value ?? '' : '');
      setNote({ tone: 'ok', text: value === null ? 'Back to the env default.' : `Saved — mails now go to ${data.notifyInbox.value}.` });
    } catch {
      setNote({ tone: 'warn', text: 'Could not save.' });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setNote(null);
    try {
      const to = draft.trim() || undefined;
      const res = await fetch('/api/admin/contacts/test-mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(to ? { to } : {}) });
      const data = (await res.json().catch(() => ({}))) as { sent?: boolean; to?: string; reason?: string | null; error?: string };
      if (!res.ok) { setNote({ tone: 'warn', text: data.error ?? 'Could not send the test.' }); return; }
      if (data.sent) setNote({ tone: 'ok', text: `Test sent to ${data.to}. Check the inbox.` });
      else if (data.reason === 'smtp_unset') setNote({ tone: 'warn', text: 'No mail was sent — SMTP is not configured on this deployment.' });
      else if (data.reason === 'no_address') setNote({ tone: 'warn', text: 'No mail was sent — no address is set.' });
      else setNote({ tone: 'warn', text: `The mail provider refused the send to ${data.to}. Check the sending domain.` });
    } catch {
      setNote({ tone: 'warn', text: 'Could not send the test.' });
    } finally {
      setBusy(null);
    }
  };

  const sourceLine = !inbox
    ? 'Loading…'
    : inbox.source === 'setting'
      ? `Mails go to ${inbox.value} (set here).`
      : inbox.source === 'env'
        ? `Mails go to ${inbox.value} (the deployment's CONTACT_EMAIL / EMAIL_FROM).`
        : 'No address is set — mails are skipped until one is.';

  return (
    <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" aria-label="Notify inbox" data-notify-inbox-card="">
      <h2 className="text-lg font-semibold text-primary mb-1">Where sign-ups and inquiries are mailed</h2>
      <p className="text-sm text-muted" data-notify-inbox-source={inbox?.source ?? 'loading'}>{sourceLine}</p>
      {smtp === false && <p className="mt-1 text-xs text-warning-fg">SMTP is not configured on this deployment, so nothing is mailed yet; the rows are still kept.</p>}
      <form
        className="mt-4 flex flex-col sm:flex-row gap-3"
        onSubmit={e => {
          e.preventDefault();
          if (draft.trim()) void put(draft.trim());
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Inbox address</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="you@yourbusiness.ca"
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-base text-primary min-h-[44px]"
            data-notify-inbox-input=""
          />
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={busy !== null || !draft.trim()} className="ea-cta rounded-lg px-4 py-2 min-h-[44px] text-sm font-semibold disabled:opacity-50" data-notify-inbox-save="">
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={test} disabled={busy !== null} className="ea-interactive rounded-lg border border-border px-4 py-2 min-h-[44px] text-sm font-semibold text-primary disabled:opacity-50" data-notify-inbox-test="">
            {busy === 'test' ? 'Sending…' : 'Send a test email'}
          </button>
        </div>
      </form>
      {inbox?.source === 'setting' && (
        <button type="button" onClick={() => put(null)} disabled={busy !== null} className="mt-2 min-h-[44px] px-1 text-sm font-medium text-brand-fg underline disabled:opacity-50" data-notify-inbox-clear="">
          Use the env default instead
        </button>
      )}
      {note && (
        <p className={`mt-3 text-sm ${note.tone === 'ok' ? 'text-success-fg' : 'text-warning-fg'}`} role="status" data-notify-inbox-note={note.tone}>
          {note.text}
        </p>
      )}
    </section>
  );
}
