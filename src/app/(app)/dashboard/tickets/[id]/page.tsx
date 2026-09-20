'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { SeverityChip, StatusChip, TypeChip, ago, eventLine, reasonLabel, resolutionLabel } from '@/components/tickets/ticket-ui';
import SnapshotView from '@/components/tickets/SnapshotView';
import { ladderSuggestion } from '@/lib/moderation/state';
import {
  RESOLUTION_CODES,
  RESOLUTION_CODE_LABELS,
  SUGGESTION_TAGS,
  TICKET_LIMITS,
  TICKET_SEVERITIES,
  type ResolutionCode,
  type SuggestionTag,
  type TicketSeverity,
} from '@/lib/tickets/types';
import type { AdminTicketDetail } from '@/lib/tickets/server';

// One ticket (Support & Reporting, Spec 1): the admin projection, the whole
// history, the reporter / target context (masked names, the DERIVED strike
// count), and every action the doc's review protocol needs — take it,
// reply, note, severity, assign, resolve with a code, close, reopen. Every
// write goes through the API (requireModerator); the page only reflects.
// Unsent text in the reply / note / resolution boxes is guarded on leave.

type Detail = AdminTicketDetail;

export default function SupportTicketPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'missing' | 'error'>('loading');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [waitOnUser, setWaitOnUser] = useState(true);
  const [note, setNote] = useState('');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolutionCode, setResolutionCode] = useState<ResolutionCode | ''>('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [confirmResolve, setConfirmResolve] = useState(false);

  const loadRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!loading && !user) router.replace('/');
    if (!user || !id) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`/api/admin/tickets/${id}`, { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) { setState('forbidden'); return; }
        if (res.status === 404) { setState('missing'); return; }
        if (!res.ok) { setState('error'); return; }
        const data = (await res.json()) as Detail;
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
  }, [user, loading, router, id]);

  const isDirty = useCallback(() => reply.trim().length > 0 || note.trim().length > 0 || resolutionNote.trim().length > 0, [reply, note, resolutionNote]);
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, () => router.push('/dashboard/tickets'));

  const call = async (path: string, method: 'PATCH' | 'POST', body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === 'string' ? data.error : 'That did not work. Try again.');
        return false;
      }
      await loadRef.current();
      return true;
    } catch {
      setError('That did not work. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const patch = (body: Record<string, unknown>) => call(`/api/admin/tickets/${id}`, 'PATCH', body);
  const act = (action: string) => call(`/api/admin/tickets/${id}/actions`, 'POST', { action });

  const sendReply = async () => {
    if (!reply.trim()) return;
    if (await call(`/api/admin/tickets/${id}/reply`, 'POST', { body: reply.trim(), waitOnUser })) setReply('');
  };
  const addNote = async () => {
    if (!note.trim()) return;
    if (await call(`/api/admin/tickets/${id}/notes`, 'POST', { body: note.trim() })) setNote('');
  };
  const resolve = async () => {
    setConfirmResolve(false);
    if (!resolutionCode) { setError('Pick a resolution code.'); return; }
    if (await patch({ status: 'resolved', resolution_code: resolutionCode, resolution_note: resolutionNote.trim() || null })) {
      setResolveOpen(false);
      setResolutionNote('');
      setResolutionCode('');
    }
  };

  const t = detail?.ticket;
  const open = t ? t.status !== 'resolved' && t.status !== 'closed' : false;

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <button type="button" onClick={requestClose} className="text-sm text-brand-fg hover:underline mb-4 inline-flex items-center gap-2">
          <i className="fas fa-arrow-left text-xs"></i> Support queue
        </button>

        {state === 'loading' && <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>}
        {state === 'forbidden' && <p className="text-sm text-tertiary">Support-queue access required.</p>}
        {state === 'missing' && <p className="text-sm text-tertiary">No such ticket.</p>}
        {state === 'error' && (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <p role="alert" className="text-sm text-tertiary mb-4">Couldn&apos;t load the ticket.</p>
            <button type="button" onClick={() => { setState('loading'); loadRef.current(); }} className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] bg-brand text-white rounded-lg text-sm font-semibold hover:bg-brand-hover transition">
              <i className="fas fa-rotate-right text-xs"></i> Try again
            </button>
          </div>
        )}

        {state === 'ready' && t && detail && (
          <>
            <header className="mb-6">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="font-mono text-sm text-muted" data-ticket-number="">{t.numberLabel}</span>
                <SeverityChip severity={t.severity} />
                <StatusChip status={t.status} />
                <TypeChip type={t.type} subtype={t.subtype} />
                {t.overdue && <span className="inline-flex items-center rounded-full bg-red-600 text-white px-2 py-0.5 text-xs font-semibold">Overdue</span>}
              </div>
              <h1 className="text-2xl font-bold text-primary">{t.subject || reasonLabel(t.type, t.reason)}</h1>
              <p className="text-sm text-tertiary mt-1">
                {reasonLabel(t.type, t.reason)} · opened {ago(t.created_at)} · first response {t.first_response_at ? ago(t.first_response_at) : `due ${t.responseTarget}`}
                {t.report_count > 1 ? ` · ${t.report_count} reports merged` : ''}
              </p>
            </header>

            {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300 mb-4">{error}</p>}

            {/* Controls */}
            <section className="ea-surface rounded-lg p-4 mb-4 grid gap-3 sm:grid-cols-3" aria-label="Ticket controls">
              <label className="text-xs text-muted">
                Severity
                <select
                  value={t.severity}
                  disabled={busy}
                  onChange={e => patch({ severity: e.target.value as TicketSeverity })}
                  className="mt-1 block w-full min-h-[40px] rounded-lg border border-border bg-surface px-2 text-sm text-primary"
                >
                  {TICKET_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted">
                Assignee
                <select
                  value={t.assignee_profile_id ?? ''}
                  disabled={busy}
                  onChange={e => patch({ assignee_profile_id: e.target.value || null })}
                  className="mt-1 block w-full min-h-[40px] rounded-lg border border-border bg-surface px-2 text-sm text-primary"
                >
                  <option value="">Unassigned</option>
                  {detail.assignees.map(a => <option key={a.profile_id} value={a.profile_id}>{a.name} ({a.role})</option>)}
                </select>
              </label>
              {t.type === 'suggestion' && (
                <label className="text-xs text-muted">
                  Review tag
                  <select
                    value={t.suggestion_tag ?? ''}
                    disabled={busy}
                    onChange={e => patch({ suggestion_tag: (e.target.value || null) as SuggestionTag | null })}
                    className="mt-1 block w-full min-h-[40px] rounded-lg border border-border bg-surface px-2 text-sm text-primary"
                  >
                    <option value="">Untagged</option>
                    {SUGGESTION_TAGS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              )}
              <div className="sm:col-span-3 flex flex-wrap gap-2 pt-1">
                {t.status === 'new' && (
                  <button type="button" disabled={busy} onClick={() => patch({ status: 'in_review' })} className="px-3 py-2 min-h-[40px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition" data-ticket-take="">
                    Take into review
                  </button>
                )}
                {open && (
                  <button type="button" disabled={busy} onClick={() => setResolveOpen(v => !v)} className="px-3 py-2 min-h-[40px] rounded-lg border border-border bg-surface text-sm font-semibold text-primary ea-interactive" data-ticket-resolve-toggle="">
                    Resolve…
                  </button>
                )}
                {t.status === 'resolved' && (
                  <button type="button" disabled={busy} onClick={() => patch({ status: 'closed' })} className="px-3 py-2 min-h-[40px] rounded-lg border border-border bg-surface text-sm font-semibold text-primary ea-interactive">
                    Close
                  </button>
                )}
                {!open && (
                  <button type="button" disabled={busy} onClick={() => patch({ status: 'in_review' })} className="px-3 py-2 min-h-[40px] rounded-lg border border-border bg-surface text-sm font-semibold text-primary ea-interactive">
                    Reopen
                  </button>
                )}
              </div>
              {resolveOpen && open && (
                <div className="sm:col-span-3 border-t border-border pt-3 grid gap-2" data-ticket-resolve-form="">
                  <label className="text-xs text-muted">
                    Resolution
                    <select value={resolutionCode} onChange={e => setResolutionCode(e.target.value as ResolutionCode | '')} className="mt-1 block w-full min-h-[40px] rounded-lg border border-border bg-surface px-2 text-sm text-primary">
                      <option value="">Pick one</option>
                      {RESOLUTION_CODES.map(c => <option key={c} value={c}>{RESOLUTION_CODE_LABELS[c]}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-muted">
                    What we decided, in plain words (the user reads this)
                    <textarea value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} maxLength={TICKET_LIMITS.resolutionNote} rows={3} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary" />
                  </label>
                  <div>
                    <button type="button" disabled={busy || !resolutionCode} onClick={() => setConfirmResolve(true)} className="px-3 py-2 min-h-[40px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition disabled:opacity-50" data-ticket-resolve="">
                      Resolve and notify
                    </button>
                  </div>
                </div>
              )}
              {!open && t.resolution_code && (
                <p className="sm:col-span-3 text-sm text-secondary">
                  <strong>{resolutionLabel(t.resolution_code)}</strong>
                  {t.resolution_note ? ` — ${t.resolution_note}` : ''}
                </p>
              )}
            </section>

            {/* Spec 2: the one-click actions before a decision (each stamps the ticket). */}
            {t.type === 'report' && (
              <section className="ea-surface rounded-lg p-4 mb-4" aria-label="Enforcement" data-ticket-enforcement="">
                <h2 className="text-sm font-semibold text-primary mb-2">Right now</h2>
                <div className="flex flex-wrap gap-2 items-center text-sm">
                  {detail.enforcement.contentHidden !== null && (
                    <>
                      <span className="text-secondary">{detail.enforcement.contentHidden ? 'Content hidden' : 'Content visible'}</span>
                      <button type="button" disabled={busy} onClick={() => act(detail.enforcement.contentHidden ? 'unhide' : 'hide')} className="px-3 py-1.5 min-h-[36px] rounded-lg border border-border bg-surface text-xs font-semibold text-primary ea-interactive" data-ticket-action={detail.enforcement.contentHidden ? 'unhide' : 'hide'}>
                        {detail.enforcement.contentHidden ? 'Unhide' : 'Hide'}
                      </button>
                    </>
                  )}
                  {detail.enforcement.conversationFrozen !== null && (
                    <>
                      <span className="text-secondary">{detail.enforcement.conversationFrozen ? 'Thread frozen' : 'Thread open'}</span>
                      <button type="button" disabled={busy} onClick={() => act(detail.enforcement.conversationFrozen ? 'unfreeze' : 'freeze')} className="px-3 py-1.5 min-h-[36px] rounded-lg border border-border bg-surface text-xs font-semibold text-primary ea-interactive" data-ticket-action={detail.enforcement.conversationFrozen ? 'unfreeze' : 'freeze'}>
                        {detail.enforcement.conversationFrozen ? 'Unfreeze' : 'Freeze'}
                      </button>
                    </>
                  )}
                  {detail.enforcement.subjectState !== null && (
                    <>
                      <span className="text-secondary">
                        Account {detail.enforcement.subjectState}
                        {detail.enforcement.subjectUntil ? ` until ${new Date(detail.enforcement.subjectUntil).toLocaleDateString()}` : ''}
                      </span>
                      {detail.enforcement.subjectState === 'active' ? (
                        <button type="button" disabled={busy} onClick={() => act('limit')} className="px-3 py-1.5 min-h-[36px] rounded-lg border border-border bg-surface text-xs font-semibold text-primary ea-interactive" data-ticket-action="limit">
                          Limit (read-only)
                        </button>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => act('lift')} className="px-3 py-1.5 min-h-[36px] rounded-lg border border-border bg-surface text-xs font-semibold text-primary ea-interactive" data-ticket-action="lift">
                          Lift
                        </button>
                      )}
                    </>
                  )}
                </div>
                {detail.target && (
                  <p className="text-xs text-muted mt-2" data-ticket-ladder="">
                    Prior strikes: {detail.target.strikes} — the ladder suggests <strong>{ladderSuggestion(detail.target.strikes)}</strong> for a confirmed violation. Critical cases may skip ahead. The resolution code you pick is the action.
                  </p>
                )}
              </section>
            )}

            {/* The request */}
            <section className="ea-surface rounded-lg p-4 mb-4">
              <h2 className="text-sm font-semibold text-primary mb-2">The request</h2>
              {t.description ? <p className="text-sm text-primary whitespace-pre-wrap">{t.description}</p> : <p className="text-sm text-muted">No description.</p>}
              {t.content_snapshot && (
                <div className="mt-3 border-t border-border pt-3" data-ticket-snapshot="">
                  <p className="text-xs text-muted mb-2">The reported content, as it was at report time</p>
                  <SnapshotView snapshot={t.content_snapshot} targetId={t.target_id} />
                </div>
              )}
            </section>

            {/* Context */}
            <section className="grid sm:grid-cols-2 gap-4 mb-4">
              <PersonCard title="Reporter" person={detail.reporter} email={t.reporter_email ?? t.guest_email} />
              {(t.type === 'report' || detail.target) && <PersonCard title="Reported user" person={detail.target} strikes />}
            </section>

            {/* Reply + note */}
            {t.status !== 'closed' && (
              <section className="ea-surface rounded-lg p-4 mb-4 grid gap-3">
                <label className="text-xs text-muted">
                  Reply to the user (they get a bell and an email)
                  <textarea value={reply} onChange={e => setReply(e.target.value)} maxLength={TICKET_LIMITS.reply} rows={3} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary" data-ticket-reply-box="" />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-secondary">
                    <input type="checkbox" checked={waitOnUser} onChange={e => setWaitOnUser(e.target.checked)} />
                    Mark as waiting on the user
                  </label>
                  <button type="button" disabled={busy || !reply.trim()} onClick={sendReply} className="px-3 py-2 min-h-[40px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition disabled:opacity-50" data-ticket-send-reply="">
                    Send reply
                  </button>
                </div>
                <label className="text-xs text-muted border-t border-border pt-3">
                  Internal note (never shown to the user)
                  <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={TICKET_LIMITS.note} rows={2} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary" data-ticket-note-box="" />
                </label>
                <div>
                  <button type="button" disabled={busy || !note.trim()} onClick={addNote} className="px-3 py-2 min-h-[40px] rounded-lg border border-border bg-surface text-sm font-semibold text-primary ea-interactive disabled:opacity-50" data-ticket-add-note="">
                    Add note
                  </button>
                </div>
              </section>
            )}

            {/* History */}
            <section className="ea-surface rounded-lg p-4">
              <h2 className="text-sm font-semibold text-primary mb-3">History</h2>
              <ol className="space-y-3" data-ticket-history="">
                {detail.events.map(e => (
                  <li key={e.id} className={`text-sm ${e.kind === 'note' ? 'border-l-2 border-amber-400 pl-3' : e.visible_to_user ? 'border-l-2 border-brand pl-3' : 'border-l-2 border-border pl-3'}`}>
                    <p className="text-xs text-muted">
                      {eventLine(e.kind, e.old_value, e.new_value)} · {e.actorName ?? 'system'} · {ago(e.created_at)}
                      {e.kind === 'note' ? ' · internal' : ''}
                    </p>
                    {e.body && <p className="text-primary whitespace-pre-wrap mt-1">{e.body}</p>}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </main>

      <ConfirmModal
        isOpen={confirmResolve}
        title="Resolve this ticket?"
        message={`The user will be told the outcome by bell and email${resolutionCode ? ` (${RESOLUTION_CODE_LABELS[resolutionCode]})` : ''}. They may appeal once by replying.`}
        confirmText="Resolve"
        onConfirm={resolve}
        onCancel={() => setConfirmResolve(false)}
      />
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>
  );
}

function PersonCard({ title, person, email, strikes }: { title: string; person: AdminTicketDetail['reporter']; email?: string | null; strikes?: boolean }) {
  return (
    <div className="ea-surface rounded-lg p-4">
      <h2 className="text-sm font-semibold text-primary mb-1">{title}</h2>
      {!person ? (
        <p className="text-sm text-muted">{email ? `Guest · ${email}` : 'Not on the platform (or anonymized).'}</p>
      ) : (
        <>
          <p className="text-sm text-primary">
            {person.name}
            {person.handle ? <span className="text-muted"> @{person.handle}</span> : null}
          </p>
          {email && <p className="text-xs text-muted">{email}</p>}
          <p className="text-xs text-muted mt-1">
            {person.accountAgeDays !== null ? `Account ${person.accountAgeDays} d old` : 'Account age unknown'} · {person.ticketsFiled} filed · {person.ticketsAgainst} against
            {strikes ? ` · ${person.strikes} strike${person.strikes === 1 ? '' : 's'}` : ''}
          </p>
          <a href={`/athlete/${person.profileId}`} className="text-xs text-brand-fg hover:underline mt-1 inline-block">View profile</a>
        </>
      )}
    </div>
  );
}
