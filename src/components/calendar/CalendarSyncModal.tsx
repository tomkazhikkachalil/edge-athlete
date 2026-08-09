'use client';

import { useEffect, useState } from 'react';
import { X, CalendarSync } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';

// "See your Edge Athlete events in Google/Outlook": creates a personal
// subscribe link (capability URL — shown ONCE, hash-stored server-side).
// Regenerating invalidates the old link everywhere it was added.

export default function CalendarSyncModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { showSuccess, showError } = useToast();
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  useBodyScrollLock(isOpen);

  // Reset on open during render; the fetch stays in the effect.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setUrl(null);
      setLoading(true);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const res = await fetch('/api/calendar/feed-token');
        const data = await res.json().catch(() => ({}));
        if (res.ok) setExists(!!data.exists);
      } catch {
        // status is a nicety; the create button still works
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen]);

  if (!isOpen) return null;

  const create = async () => {
    setConfirmRotate(false);
    setCreating(true);
    try {
      const res = await fetch('/api/calendar/feed-token', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showError('Could not create the link', data.error || 'Please try again.'); return; }
      setUrl(data.url);
      setExists(true);
    } catch {
      showError('Could not create the link', 'Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showSuccess('Copied', 'Paste it into Google or Outlook.');
    } catch {
      showError('Could not copy', 'Select and copy the link manually.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-raised rounded-lg shadow-xl max-w-lg w-full max-h-modal overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-full bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center">
              <CalendarSync className="w-5 h-5 text-brand-fg" />
            </span>
            <h2 className="text-lg font-bold text-primary">Sync to another calendar</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ea-icon-btn inline-flex items-center justify-center shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-tertiary">
            Subscribe once from Google or Outlook and your Edge Athlete events
            appear there automatically and stay updated. The link is read-only.
          </p>

          {loading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
            </div>
          ) : url ? (
            <div className="space-y-3">
              <div className="bg-brand-soft border border-violet-200 dark:border-violet-800 rounded-lg p-3">
                <p className="text-xs font-semibold text-violet-800 dark:text-violet-200 mb-1.5">
                  Your personal calendar link — treat it like a password:
                </p>
                <code className="block text-xs text-primary break-all select-all mb-2">{url}</code>
                <button
                  type="button"
                  onClick={copy}
                  className="bg-brand text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-brand-hover"
                >
                  <i className="fas fa-copy mr-1.5"></i>
                  Copy link
                </button>
              </div>
              <p className="text-xs text-muted">
                This is the only time the link is shown. Anyone with it can see
                your events; if it ever leaks, regenerate it here and the old
                link stops working.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => (exists ? setConfirmRotate(true) : create())}
              disabled={creating}
              className="w-full bg-brand text-white py-3 px-4 rounded-lg hover:bg-brand-hover transition flex items-center justify-center text-sm font-medium disabled:opacity-50 min-h-[44px]"
            >
              {creating ? (
                <><i className="fas fa-spinner fa-spin mr-2"></i> Creating…</>
              ) : exists ? 'Regenerate my calendar link' : 'Create my calendar link'}
            </button>
          )}
          {exists && !url && !loading && (
            <p className="text-xs text-muted">
              You already have a link. For your security it can&apos;t be shown
              again — regenerating creates a new one and invalidates the old.
            </p>
          )}

          <div className="border-t border-border-subtle pt-4 text-xs text-muted space-y-2">
            <p className="font-semibold text-secondary">How to subscribe</p>
            <p>
              <span className="font-medium text-secondary">Google Calendar:</span>{' '}
              Settings → Add calendar → From URL → paste the link.
            </p>
            <p>
              <span className="font-medium text-secondary">Outlook:</span>{' '}
              Add calendar → Subscribe from web → paste the link.
            </p>
            <p className="text-faint">
              Calendar apps refresh subscriptions on their own schedule —
              new events can take a few hours to appear there.
            </p>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmRotate}
        title="Regenerate your calendar link?"
        message="Your current link will stop working everywhere it was added. You'll need to re-subscribe with the new one."
        confirmText="Regenerate"
        cancelText="Keep current link"
        confirmButtonClass="bg-brand hover:bg-brand-hover"
        onConfirm={create}
        onCancel={() => setConfirmRotate(false)}
      />
    </div>
  );
}
