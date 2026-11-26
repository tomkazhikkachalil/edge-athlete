'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import PostCard, { type PostCardPost } from '@/components/PostCard';
import { CloseIcon } from '@/components/golf/scoring/icons';
import { EyeIcon } from './icons';

/**
 * The post's preview (Tom's General post spec, Nov 26 2026 — D3, A5, R5):
 * the REAL feed card, built from what has been entered, in a column 400 px
 * wide at most. One key under it: Edit, back to the composer. No Post key
 * here — posting is the slide's, always.
 *
 * Drawn through a portal on <body>: the composer wears the mechanical
 * palette, which re-points the house tokens, and the card must look exactly
 * as it will on the feed. Only the top line and the Edit key wear the
 * dialect; the card sits outside it.
 */
interface PreviewOverlayProps {
  post: PostCardPost;
  currentUserId: string;
  onClose: () => void;
}

export default function PreviewOverlay({ post, currentUserId, onClose }: PreviewOverlayProps) {
  const editRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    editRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Post preview"
      className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ backgroundColor: 'rgb(5 4 8 / 0.86)' }}
      data-compose-preview=""
    >
      <div className="mx-auto flex min-h-full w-full max-w-[400px] flex-col gap-3 px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))]">
        {/* The scrim is dark in both themes, so this line and the Edit key use
            the dialect's DARK values as written (a light theme's tokens would
            draw dark text on it). */}
        <div className="ea-mech flex h-11 shrink-0 items-center justify-between">
          <span className="inline-flex items-center gap-2 text-[#bba6ff]">
            <EyeIcon size={16} />
            <span className="ea-mech-micro" style={{ color: '#bba6ff' }}>Preview</span>
          </span>
          <button type="button" onClick={onClose} aria-label="Close preview" className="inline-flex h-11 w-11 items-center justify-center rounded-full">
            <span aria-hidden="true" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#26252d] text-[#c9c6d1]">
              <CloseIcon size={16} />
            </span>
          </button>
        </div>

        <div className="min-w-0" data-compose-preview-card="">
          <PostCard post={post} currentUserId={currentUserId} showActions={false} inReview preview />
        </div>

        <button
          ref={editRef}
          type="button"
          onClick={onClose}
          className="inline-flex h-12 w-full shrink-0 items-center justify-center rounded-[14px] text-[15px] font-semibold text-[#f4f3f7]"
          style={{ boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.14)' }}
          data-compose-preview-edit=""
        >
          Edit
        </button>
      </div>
    </div>,
    document.body
  );
}
