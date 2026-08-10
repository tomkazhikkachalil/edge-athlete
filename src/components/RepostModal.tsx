'use client';

import { useCallback, useEffect, useState } from 'react';
import QuotedPostEmbed, { type QuotedPost } from './QuotedPostEmbed';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useToast } from './Toast';

interface RepostModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The ROOT original to repost (PostCard collapses client-side; the
   *  server re-collapses authoritatively). */
  quotedPost: QuotedPost;
  /** Receives the created post (feed prepends it). */
  onReposted?: (post: unknown) => void;
}

/**
 * The repost composer: quoted-post preview + optional commentary. Empty
 * caption = plain repost; filled = quote post. One flow, per product
 * decision — sheet chrome mirrors SharePostModal.
 */
export default function RepostModal({ isOpen, onClose, quotedPost, onReposted }: RepostModalProps) {
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { showSuccess, showError } = useToast();

  useBodyScrollLock(isOpen);

  // Reset on the way OUT (not via a setState-in-effect on open): every close
  // path funnels through here, so a reopened modal always starts clean.
  const handleClose = useCallback(() => {
    setCaption('');
    setSubmitting(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sharedPostId: quotedPost.id,
          caption: caption.trim(),
          postType: 'general',
          visibility: 'public',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError('Repost failed', data.error || 'Something went wrong');
        return;
      }
      showSuccess('Reposted', 'Shared to your feed');
      onReposted?.(data.post);
      handleClose();
    } catch {
      showError('Repost failed', 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50" onClick={handleClose}>
      <div
        className="bg-surface-raised rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-modal flex flex-col overflow-hidden modal-sheet-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h2 className="text-lg font-bold text-primary">
            <i className="fas fa-retweet mr-2 text-brand-fg"></i>
            Repost
          </h2>
          <button
            onClick={handleClose}
            className="ea-icon-btn text-tertiary hover:text-primary"
            title="Close"
            aria-label="Close"
          >
            <i className="fas fa-times text-lg"></i>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto">
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add your thoughts (optional)…"
            rows={3}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary placeholder:text-faint resize-none"
          />
          <div className="mt-3">
            <QuotedPostEmbed post={quotedPost} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-4 py-3 border-t border-border-subtle">
          <button
            onClick={handleClose}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-secondary hover:bg-surface-sunken transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-lg ea-cta text-white text-sm font-semibold disabled:opacity-60"
          >
            {submitting ? 'Reposting…' : 'Repost'}
          </button>
        </div>
      </div>
    </div>
  );
}
