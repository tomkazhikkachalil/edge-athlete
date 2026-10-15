'use client';

import { useRef } from 'react';
import GifPicker from '@/components/GifPicker';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useFollowVisualViewport } from '@/hooks/useThreadViewport';

interface Props {
  onGifSelect: (gifUrl: string) => void;
  onClose: () => void;
  title?: string;
}

export default function GifPickerModal({ onGifSelect, onClose, title = 'Choose a GIF' }: Props) {
  // Mounted only while open; without the lock the page scrolls under the
  // sheet on touch (iOS scroll chaining).
  useBodyScrollLock(true);
  // The sheet sits inside the VISIBLE strip (its own search box raises the
  // keyboard on a phone; `inset-0` would leave it behind the keyboard —
  // Oct 14 2026). Offsets are 0 and the height the full viewport elsewhere.
  const frameRef = useRef<HTMLDivElement | null>(null);
  useFollowVisualViewport(frameRef);

  return (
    <div
      ref={frameRef}
      className="fixed inset-x-0 z-50 flex items-end sm:items-center justify-center"
      style={{ top: 'var(--ea-vv-top, 0px)', height: 'var(--ea-vv-h, 100vh)' }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative bg-surface-raised rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg flex flex-col overflow-hidden modal-sheet-bottom"
        style={{ height: 'min(70%, 520px)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h3 className="text-sm font-bold text-primary">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ea-icon-btn inline-flex items-center justify-center text-faint hover:text-tertiary"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
        <GifPicker
          variant="modal"
          onGifSelect={onGifSelect}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
