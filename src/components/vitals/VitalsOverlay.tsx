'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

/**
 * The "larger window" every bubble opens into: bottom sheet on phones,
 * centered card from sm: up (the StartWorkoutSheet shell, sized for reading
 * history). Read-only content lives here, so closing needs no confirmation —
 * Escape, backdrop, and the X all close directly. Stays below z-[60] on
 * purpose: PostDetailModal (opened by history camera buttons) must stack
 * above it.
 */
interface VitalsOverlayProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

export default function VitalsOverlay({ title, subtitle, onClose, children }: VitalsOverlayProps) {
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center ea-backdrop-fade"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ea-sheet-pop bg-surface-raised rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-modal overflow-hidden flex flex-col modal-sheet-bottom"
      >
        <div className="shrink-0 flex items-center justify-between gap-3 p-4 sm:px-6 border-b border-border-subtle">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-primary truncate">{title}</h2>
            {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-full text-faint hover:text-tertiary hover:bg-surface-muted transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
