'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import ConfirmModal from '@/components/ConfirmModal';
import { COPY } from '@/lib/copy';
import type { OrgKind } from '@/lib/orgs/org-ref';
import { REPORT_REASONS, REPORT_REASON_LABELS, TICKET_LIMITS, type ReportReason, type TicketTargetType } from '@/lib/tickets/types';

/**
 * The ONE report sheet (Support & Reporting, Spec 2) — opened from a post,
 * a comment, a profile or a DM thread's "…". The doc's reason list (one
 * list, reused everywhere), optional details, submit → `POST /api/tickets`
 * with the target (the server snapshots it) → the done state offers Block
 * and Mute (both immediate, neither waits for review) and, for a self-harm
 * concern, the crisis resources. Grown from ReportMessageModal's shape:
 * portal, z-[60], the refcounted body-scroll lock, Escape; typed details
 * are guarded on close by useDirtyClose (the house rule).
 */
export interface ReportTarget {
  type: TicketTargetType;
  id: string;
  /** The reported person — Block / Mute act on them. Null when unknown (a group thread). */
  profileId: string | null;
  /** The words the header uses: "Report this post". */
  noun: 'post' | 'comment' | 'profile' | 'conversation' | 'message' | OrgKind | 'event';
}

interface Props {
  target: ReportTarget;
  onClose: () => void;
  /** After a successful submit — the caller may re-fetch or toast. */
  onSubmitted?: (result: { number: string; severity: string }) => void;
  /** Results-kept (241): open with a reason picked (the event page's "This result isn't me"). */
  initialReason?: ReportReason;
}

const HINTS: Record<ReportReason, string> = {
  harassment_bullying: 'Bullying, threats or unwanted contact',
  hate_discrimination: 'Slurs or content targeting a person or group',
  sexual_content: 'Sexual or explicit material',
  spam_scam: 'Unwanted promotion, scams or repeated messages',
  impersonation: 'Pretending to be someone they are not',
  self_harm: 'Someone may be at risk of hurting themselves',
  minor_safety: 'A child or teen may be in danger',
  wrong_person: 'A result here is recorded under my name, but it isn’t mine',
  other: "Doesn't fit the reasons above",
};

export default function ReportSheet({ target, onClose, onSubmitted, initialReason }: Props) {
  const [reason, setReason] = useState<ReportReason | ''>(initialReason ?? '');
  // "This result isn't me" is about an EVENT's result — only an event report offers it.
  const reasons = REPORT_REASONS.filter(r => r !== 'wrong_person' || target.type === 'sport_event');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ number: string; severity: string } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [acting, setActing] = useState<'block' | 'mute' | null>(null);

  useBodyScrollLock(true);
  const isDirty = useCallback(() => !done && (details.trim().length > 0 || reason !== (initialReason ?? '')), [done, details, reason, initialReason]);
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, onClose);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) requestClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [requestClose, submitting]);

  const submit = async () => {
    if (!reason) { setError('Pick a reason.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'report', reason, description: details.trim() || undefined, target: { type: target.type, id: target.id } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not send the report. Try again.'); return; }
      setDone({ number: data.number, severity: data.severity });
      onSubmitted?.({ number: data.number, severity: data.severity });
    } catch {
      setError('Could not send the report. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const block = async () => {
    if (!target.profileId) return;
    setActing('block');
    try {
      const res = await fetch('/api/messages/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockedId: target.profileId }) });
      if (res.ok) setBlocked(true);
    } finally {
      setActing(null);
    }
  };
  const mute = async () => {
    if (!target.profileId) return;
    setActing('mute');
    try {
      const res = await fetch('/api/mutes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: target.profileId }) });
      if (res.ok) setMuted(true);
    } finally {
      setActing(null);
    }
  };

  const showCrisis = reason === 'self_harm';

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" data-report-sheet="">
      <div className="absolute inset-0 bg-black/40" onClick={() => !submitting && (done ? onClose() : requestClose())} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={`Report this ${target.noun}`} className="relative bg-surface-raised rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md max-h-modal overflow-y-auto safe-bottom ea-sheet-pop">
        <div className="px-5 pt-5 pb-3 border-b border-border-subtle">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-primary">{done ? COPY.SUPPORT.REPORT_DONE_TITLE : `${COPY.SUPPORT.REPORT_TITLE} this ${target.noun}`}</h2>
            <button type="button" onClick={() => !submitting && (done ? onClose() : requestClose())} className="ea-icon-btn inline-flex items-center justify-center -my-2 -mr-2" aria-label="Close">
              <i className="fas fa-times text-base"></i>
            </button>
          </div>
          {!done && <p className="text-xs text-muted mt-1">{COPY.SUPPORT.REPORT_INTRO}</p>}
        </div>

        {done ? (
          <div className="px-5 py-5 space-y-4" data-report-done={done.number}>
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 mb-2">
                <i className="fas fa-check text-xl"></i>
              </div>
              <p className="text-sm font-semibold text-primary">Ticket {done.number}</p>
              <p className="text-xs text-muted mt-1">{COPY.SUPPORT.REPORT_DONE_BODY}</p>
            </div>
            {showCrisis && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3" data-report-crisis="">
                <p className="text-sm font-semibold text-primary">{COPY.SUPPORT.CRISIS_TITLE}</p>
                <p className="text-sm text-secondary mt-1">{COPY.SUPPORT.CRISIS_BODY}</p>
              </div>
            )}
            {target.profileId && (
              <div className="grid gap-2">
                <p className="text-xs text-muted">You can also, right now:</p>
                <button type="button" disabled={blocked || acting !== null} onClick={block} className="ea-surface rounded-lg px-4 py-3 text-left ea-interactive disabled:opacity-60" data-report-block="">
                  <span className="text-sm font-semibold text-primary">{blocked ? 'Blocked' : COPY.SUPPORT.BLOCK_OFFER}</span>
                  <span className="block text-xs text-muted">{COPY.SUPPORT.BLOCK_HINT}</span>
                </button>
                <button type="button" disabled={muted || acting !== null} onClick={mute} className="ea-surface rounded-lg px-4 py-3 text-left ea-interactive disabled:opacity-60" data-report-mute="">
                  <span className="text-sm font-semibold text-primary">{muted ? 'Muted' : COPY.SUPPORT.MUTE_OFFER}</span>
                  <span className="block text-xs text-muted">{COPY.SUPPORT.MUTE_HINT}</span>
                </button>
              </div>
            )}
            <button type="button" onClick={onClose} className="w-full px-4 py-2 min-h-[44px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition">
              Done
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <fieldset className="space-y-1" data-report-reasons="">
              <legend className="text-sm font-medium text-primary mb-2">Why are you reporting this?</legend>
              {reasons.map(r => (
                <label key={r} className={`flex items-start gap-3 rounded-lg px-3 py-2 cursor-pointer ea-interactive ${reason === r ? 'bg-brand-soft' : ''}`}>
                  <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="mt-1" />
                  <span>
                    <span className="block text-sm text-primary">{REPORT_REASON_LABELS[r]}</span>
                    <span className="block text-xs text-muted">{HINTS[r]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {showCrisis && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3" data-report-crisis="">
                <p className="text-sm font-semibold text-primary">{COPY.SUPPORT.CRISIS_TITLE}</p>
                <p className="text-sm text-secondary mt-1">{COPY.SUPPORT.CRISIS_BODY}</p>
              </div>
            )}
            <label className="block text-sm text-secondary">
              Anything else? <span className="text-muted">(optional)</span>
              <textarea value={details} onChange={e => setDetails(e.target.value)} maxLength={TICKET_LIMITS.description} rows={3} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary" data-report-details="" />
            </label>
            {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
            <button type="button" disabled={submitting || !reason} onClick={submit} className="w-full px-4 py-2 min-h-[44px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition disabled:opacity-50" data-report-submit="">
              {submitting ? 'Sending…' : 'Send report'}
            </button>
          </div>
        )}
      </div>
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        overlayZClass="z-[65]"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>,
    document.body
  );
}
