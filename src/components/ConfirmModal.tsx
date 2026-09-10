'use client';

import { useEffect, useRef } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
  /** Overlay z-index class. Raise it above z-[60] when the caller's own
   *  overlay sits higher (e.g. the full-bleed media editor at z-[65]). */
  overlayZClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmButtonClass = 'bg-red-600 hover:bg-red-700',
  overlayZClass = 'z-[60]',
  onConfirm,
  onCancel
}: ConfirmModalProps) {
  // Lock background scroll while open (iOS scroll-chaining behind overlays)
  useBodyScrollLock(isOpen);
  // B4: a real dialog — Escape cancels (the topmost-dialog rule: LargerWindow
  // defers to a later [role="dialog"]), focus lands on Cancel when it opens.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    cancelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  // z-[60]: ConfirmModal can stack over z-50 modals (e.g. End Round over
  // SharedRoundFullCard) — same layer would rely on DOM order alone.
  return (
    <div className={`fixed inset-0 bg-black/50 ${overlayZClass} flex items-center justify-center p-4`}>
      <div className="bg-surface-raised rounded-lg shadow-xl max-w-md w-full max-h-modal overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-border">
          <h2 id="confirm-modal-title" className="text-xl font-bold text-primary">{title}</h2>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6">
          <p className="text-secondary">{message}</p>
        </div>

        {/* Footer. Stacked full-width below sm — the long copy pairs
            ("Discard changes" / "Keep editing") overflowed a 320px row. The
            confirm action stays first in the stack (col-reverse). */}
        <div className="p-4 sm:p-6 border-t border-border flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 border border-border-strong rounded-lg text-secondary hover:bg-surface-muted transition-colors font-medium"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-white transition-colors font-medium ${confirmButtonClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
