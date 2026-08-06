'use client';

import { useEffect, useState } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const REASONS: { value: string; label: string; hint: string }[] = [
  { value: 'spam', label: 'Spam', hint: 'Unwanted promotional content or repeated messages' },
  { value: 'harassment', label: 'Harassment', hint: 'Bullying, threats, or unwanted contact' },
  { value: 'hateful', label: 'Hateful content', hint: 'Slurs or content targeting a person or group' },
  { value: 'sexual', label: 'Sexual content', hint: 'Sexually explicit or inappropriate material' },
  { value: 'violence', label: 'Violence', hint: 'Threats or content depicting harm' },
  { value: 'other', label: 'Other', hint: 'Doesn\'t fit any category above' },
];

const MAX_DETAILS_LEN = 1000;

interface Props {
  messageId?: string;
  reportedProfileId?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

export default function ReportMessageModal({
  messageId,
  reportedProfileId,
  onClose,
  onSubmitted,
}: Props) {
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // Refcounted lock, not a hand-rolled body.style.overflow — the manual
  // version fights other overlays' cleanup when modals stack.
  useBodyScrollLock(true);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, submitting]);

  const handleSubmit = async () => {
    if (!reason) {
      setError('Please choose a reason');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = { reason };
      if (details.trim()) body.details = details.trim();
      if (messageId) body.messageId = messageId;
      if (reportedProfileId && !messageId) body.reportedProfileId = reportedProfileId;

      const res = await fetch('/api/messages/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to file report');
      }
      setDone(true);
      onSubmitted?.();
      // Auto-close after a brief confirmation
      setTimeout(() => onClose(), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to file report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !submitting && onClose()}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report message"
        className="relative bg-surface-raised rounded-2xl shadow-xl w-full max-w-md max-h-modal overflow-y-auto safe-bottom"
      >
        <div className="px-5 pt-5 pb-3 border-b border-border-subtle">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-primary">Report</h2>
            <button
              type="button"
              onClick={() => !submitting && onClose()}
              className="p-1 -m-1 text-faint hover:text-tertiary"
              aria-label="Close"
            >
              <i className="fas fa-times text-base"></i>
            </button>
          </div>
          <p className="text-xs text-muted mt-1">
            Reports are reviewed by the Edge Athlete team. Your identity is not shown to the reported user.
          </p>
        </div>

        {done ? (
          <div className="px-5 py-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 mb-3">
              <i className="fas fa-check text-xl"></i>
            </div>
            <p className="text-sm font-semibold text-primary">Report submitted</p>
            <p className="text-xs text-muted mt-1">Thanks — we&apos;ll review this shortly.</p>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 space-y-2">
              {REASONS.map(r => (
                <label
                  key={r.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    reason === r.value
                      ? 'border-violet-500 bg-brand-soft'
                      : 'border-border hover:bg-surface-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="mt-0.5 accent-violet-600"
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-primary">{r.label}</span>
                    <span className="block text-xs text-muted mt-0.5">{r.hint}</span>
                  </span>
                </label>
              ))}

              <div className="pt-2">
                <label className="block text-xs font-semibold text-secondary mb-1">
                  Additional details <span className="font-normal text-faint">(optional)</span>
                </label>
                <textarea
                  value={details}
                  onChange={e => setDetails(e.target.value.slice(0, MAX_DETAILS_LEN))}
                  rows={3}
                  placeholder="Anything else we should know?"
                  className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <p className="text-[10px] text-faint text-right mt-1">
                  {details.length}/{MAX_DETAILS_LEN}
                </p>
              </div>

              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}
            </div>

            <div className="px-5 py-4 border-t border-border-subtle flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm text-tertiary hover:text-primary transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !reason}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting…' : 'Submit report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
