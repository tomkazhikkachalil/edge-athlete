'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

/**
 * The "larger window" a bubble opens into — the house overlay, lifted from
 * vitals/VitalsOverlay in Org Pages R2 (Sep 8 2026). Bottom sheet on
 * phones, centered card from sm: up. Read-only or one-tap-reversible
 * content lives here, so closing needs no confirmation — Escape, backdrop,
 * and the X all close directly (never useDirtyClose). Stays at z-50, BELOW
 * z-[60], on purpose: PostDetailModal, MediaLightbox and ConfirmModal must
 * stack above it.
 *
 * `hostsOwnHeading`: when the hosted content already renders its own <h2>
 * (the org sections do — their heading strings are e2e contracts), the
 * header row carries only the X and `title` feeds aria-label alone, so a
 * page never shows two "Standings" headings.
 */
export interface LargerWindowProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  hostsOwnHeading?: boolean;
  /** e2e hook: data-larger-window={windowKey}. */
  windowKey?: string;
}

export default function LargerWindow({
  title,
  subtitle,
  onClose,
  children,
  hostsOwnHeading = false,
  windowKey,
}: LargerWindowProps) {
  useBodyScrollLock(true);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape closes the TOPMOST layer only (the usePopoverDismiss rule): a
      // MediaLightbox or ConfirmModal opened from inside this window renders
      // later in the DOM (z-[60], above z-50) and owns the key while it is
      // up — otherwise one Escape would close it AND the window beneath.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs.length > 0 && dialogs[dialogs.length - 1] !== dialogRef.current) return;
      onClose();
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-larger-window={windowKey}
        className="ea-sheet-pop bg-surface-raised rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-modal overflow-hidden flex flex-col modal-sheet-bottom"
      >
        <div
          className={`shrink-0 flex items-center justify-between gap-3 ${
            hostsOwnHeading ? 'px-4 pt-3 sm:px-6' : 'p-4 sm:px-6 border-b border-border-subtle'
          }`}
        >
          {hostsOwnHeading ? (
            <span className="min-w-0" />
          ) : (
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-primary truncate">{title}</h2>
              {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-full text-faint hover:text-tertiary hover:bg-surface-muted transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${hostsOwnHeading ? 'px-4 pb-4 sm:px-6 sm:pb-6' : 'p-4 sm:p-6'}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
