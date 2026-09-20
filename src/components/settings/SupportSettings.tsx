'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SeverityChip, StatusChip, TypeChip, ago, reasonLabel, resolutionLabel } from '@/components/tickets/ticket-ui';
import { HELP_CATEGORIES, HELP_CATEGORY_LABELS, TICKET_LIMITS, type HelpCategory } from '@/lib/tickets/types';
import type { SubjectTicketView, UserEventView, UserTicketView } from '@/lib/tickets/visibility';

/**
 * Settings → Support (Support & Reporting, Spec 1 — the minimal front door;
 * Spec 3 grows it into the Help Center at /help). Two parts: "Submit a
 * request" (a Help ticket: category, subject, description) and "My requests"
 * (the caller's tickets plus a guardian's supervised athletes', through the
 * API's reader scope). A row expands INLINE to the visible thread and the
 * reply box — never in a LargerWindow, which must hold no dirty input.
 * `?tab=support&ticket=<id>` (the bells' deep link) expands that row.
 */

const CREATED_DONE_MS = 6000;

export default function SupportSettings() {
  const [listKey, setListKey] = useState(0);
  return (
    <div className="space-y-8" data-support-settings="">
      <SubmitRequest onCreated={() => setListKey(k => k + 1)} />
      <Suspense fallback={null}>
        <MyRequestsWithParam listKey={listKey} />
      </Suspense>
    </div>
  );
}

function MyRequestsWithParam({ listKey }: { listKey: number }) {
  const sp = useSearchParams();
  return <MyRequests listKey={listKey} openId={sp.get('ticket')} />;
}

// ── Submit a request ────────────────────────────────────────────────────────

function SubmitRequest({ onCreated }: { onCreated: () => void }) {
  const [category, setCategory] = useState<HelpCategory>('account');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: string; target: string } | null>(null);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), CREATED_DONE_MS);
    return () => clearTimeout(t);
  }, [done]);

  const submit = async () => {
    if (!description.trim()) { setError('Tell us what happened.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'help', reason: category, subject: subject.trim() || undefined, description: description.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not send your request. Try again.'); return; }
      setDone({ number: data.number, target: data.severity === 'critical' ? 'within 1 hour' : 'within 2 business days' });
      setSubject('');
      setDescription('');
      onCreated();
    } catch {
      setError('Could not send your request. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="support-submit-heading">
      <h2 id="support-submit-heading" className="text-lg font-semibold text-primary mb-1">Submit a request</h2>
      <p className="text-sm text-tertiary mb-4">Tell us what you need. You get a ticket number and a reply here and by email.</p>
      {done && (
        <p role="status" className="mb-4 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 px-4 py-3 text-sm text-green-800 dark:text-green-300" data-support-created={done.number}>
          Sent — your ticket is <strong>{done.number}</strong>. Expect a first response {done.target}.
        </p>
      )}
      <form
        className="grid gap-3"
        onSubmit={e => { e.preventDefault(); void submit(); }}
        data-support-form=""
      >
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
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div>
          <button type="submit" disabled={busy} className="px-4 py-2 min-h-[44px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition disabled:opacity-50" data-support-submit="">
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>
    </section>
  );
}

// ── My requests ─────────────────────────────────────────────────────────────

function MyRequests({ listKey, openId }: { listKey: number; openId: string | null }) {
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [tickets, setTickets] = useState<UserTicketView[]>([]);
  // Spec 2: decisions made ABOUT this account (the restricted appeal view).
  const [aboutMe, setAboutMe] = useState<SubjectTicketView[]>([]);
  const [expanded, setExpanded] = useState<string | null>(openId);
  // A reply changes the row's status chip — the thread bumps this to refetch the list.
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tickets', { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setState('error'); return; }
        const data = (await res.json()) as { supported: boolean; tickets: UserTicketView[]; aboutMe?: SubjectTicketView[] };
        if (cancelled) return;
        setTickets(data.tickets);
        setAboutMe(data.aboutMe ?? []);
        setState(data.supported ? 'ready' : 'unsupported');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [listKey, refresh]);

  return (
    <section aria-labelledby="support-mine-heading">
      <h2 id="support-mine-heading" className="text-lg font-semibold text-primary mb-1">My requests</h2>
      <p className="text-sm text-tertiary mb-4">Everything you have sent us, and any request from an athlete you look after.</p>
      {state === 'loading' && <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand my-6"></div>}
      {state === 'unsupported' && <p className="text-sm text-muted">Support requests are not available yet.</p>}
      {state === 'error' && <p role="alert" className="text-sm text-muted">Couldn&apos;t load your requests.</p>}
      {state === 'ready' && tickets.length === 0 && aboutMe.length === 0 && <p className="text-sm text-muted">No requests yet.</p>}
      {state === 'ready' && aboutMe.length > 0 && (
        <div className="mb-6" data-about-my-account="">
          <h3 className="text-sm font-semibold text-primary mb-1">About your account</h3>
          <p className="text-xs text-muted mb-2">A decision was made after a report. You can reply once if you disagree. Who reported is never shown.</p>
          <ul className="space-y-2">
            {aboutMe.map(t => (
              <li key={t.id} className="ea-surface rounded-lg border-l-4 border-amber-400" data-my-request={t.id}>
                <button type="button" onClick={() => setExpanded(expanded === t.id ? null : t.id)} aria-expanded={expanded === t.id} className="w-full text-left p-4 ea-interactive rounded-lg">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-muted">{t.number}</span>
                    <StatusChip status={t.status} />
                  </div>
                  <p className="text-sm font-semibold text-primary">{resolutionLabel(t.resolution_code) || 'Decision'}</p>
                  <p className="text-xs text-muted mt-1">{ago(t.updated_at)}</p>
                </button>
                {expanded === t.id && <RequestThread id={t.id} onChanged={() => setRefresh(k => k + 1)} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {state === 'ready' && tickets.length > 0 && (
        <ul className="space-y-2" data-my-requests="">
          {tickets.map(t => (
            <li key={t.id} className="ea-surface rounded-lg" data-my-request={t.id}>
              <button
                type="button"
                onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                aria-expanded={expanded === t.id}
                className="w-full text-left p-4 ea-interactive rounded-lg"
              >
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-mono text-xs text-muted">{t.number}</span>
                  <StatusChip status={t.status} />
                  <TypeChip type={t.type} subtype={t.subtype} />
                  {t.type === 'report' && <SeverityChip severity={t.severity} />}
                </div>
                <p className="text-sm font-semibold text-primary">{t.subject || reasonLabel(t.type, t.reason)}</p>
                <p className="text-xs text-muted mt-1">{reasonLabel(t.type, t.reason)} · {ago(t.updated_at)}</p>
              </button>
              {expanded === t.id && <RequestThread id={t.id} onChanged={() => setRefresh(k => k + 1)} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestThread({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<{ ticket: UserTicketView | SubjectTicketView; events: UserEventView[] } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The loader lives INSIDE the effect (the set-state-in-effect rule) and is
  // published on a ref so a sent reply can await a refresh — the consent
  // page's shape.
  const loadRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`/api/tickets/${id}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) { setState('error'); return; }
        const data = await res.json();
        if (cancelled) return;
        setDetail(data);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };
    loadRef.current = run;
    run();
    return () => { cancelled = true; };
  }, [id]);

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not send your reply.'); return; }
      setReply('');
      await loadRef.current();
      onChanged();
    } catch {
      setError('Could not send your reply.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return <div className="px-4 pb-4 text-xs text-muted">Loading…</div>;
  if (state === 'error' || !detail) return <p role="alert" className="px-4 pb-4 text-xs text-muted">Couldn&apos;t load this request.</p>;
  const t = detail.ticket;

  return (
    <div className="border-t border-border px-4 py-3 space-y-3" data-request-thread="">
      {'description' in t && t.description && <p className="text-sm text-primary whitespace-pre-wrap">{t.description}</p>}
      {(t.status === 'resolved' || t.status === 'closed') && (
        <p className="text-sm text-secondary rounded-lg bg-surface-muted px-3 py-2">
          <strong>{resolutionLabel(t.resolution_code) || 'Resolved'}</strong>
          {t.resolution_note ? ` — ${t.resolution_note}` : ''}
        </p>
      )}
      <ol className="space-y-2" data-request-events="">
        {detail.events.filter(e => e.kind !== 'created').map(e => (
          <li key={e.id} className={`text-sm rounded-lg px-3 py-2 ${e.by === 'you' ? 'bg-brand-soft text-primary' : e.by === 'support' ? 'bg-surface-muted text-primary' : 'text-muted'}`}>
            <p className="text-xs text-muted mb-0.5">
              {e.by === 'you' ? 'You' : e.by === 'support' ? 'Support' : 'Update'} · {ago(e.created_at)}
              {e.kind === 'status_changed' || e.kind === 'reopened' ? ` · now ${(e.new_value ?? '').replace(/_/g, ' ')}` : ''}
            </p>
            {e.body && <p className="whitespace-pre-wrap">{e.body}</p>}
          </li>
        ))}
      </ol>
      {t.canReply ? (
        <div className="grid gap-2">
          <label className="text-xs text-muted">
            {t.replyIsAppeal ? 'Disagree? Reply once to ask us to take another look.' : 'Reply'}
            <textarea value={reply} onChange={e => setReply(e.target.value)} maxLength={TICKET_LIMITS.reply} rows={3} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary" data-request-reply-box="" />
          </label>
          {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
          <div>
            <button type="button" disabled={busy || !reply.trim()} onClick={send} className="px-3 py-2 min-h-[40px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition disabled:opacity-50" data-request-send="">
              {t.replyIsAppeal ? 'Send appeal' : 'Send reply'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">{t.status === 'closed' ? 'This request is closed. Open a new one if you need more help.' : 'This request was appealed once and reviewed again. Open a new one if you need more help.'}</p>
      )}
    </div>
  );
}
