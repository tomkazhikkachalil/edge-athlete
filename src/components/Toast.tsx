'use client';

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';

/**
 * Feedback (Tom, Oct 14 2026 — fix 1 of his seven): a visible result is its
 * own confirmation. No toast for a success the user can see on screen. What
 * remains is an ERROR (the card, `role="alert"`) and a NOTICE — a result the
 * user cannot see from here: something sent to someone else, copied,
 * published elsewhere, earned in the background, a fact about where a thing
 * went. A notice is small, quiet, one line, `role="status"`, and dismisses
 * on its own. `showSuccess`, `showInfo` and `showWarning` no longer exist, so
 * nothing can creep back; `src/lib/__tests__/toast-policy.test.ts` pins it.
 */
export interface ToastMessage {
  id: string;
  type: 'error' | 'notice';
  title: string;
  message?: string;
  duration?: number;
  /** One action inside the toast (Site Builder P3-D: "Undo" after a
   *  remove). Pressing it dismisses the toast. */
  action?: { label: string; onClick: () => void };
}

/** A notice is gone before it is read twice; an error stays long enough to read; Undo waits a little. */
export const NOTICE_MS = 3000;
export const ERROR_MS = 6000;
export const UNDO_MS = 8000;

interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

function Toast({ toast, onDismiss }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(toast.id);
    }, 300); // Match animation duration
  }, [toast.id, onDismiss]);

  useEffect(() => {
    // Entrance is CSS (.ea-toast-in) — no isVisible flag to flip.
    const duration = toast.duration || (toast.type === 'error' ? ERROR_MS : NOTICE_MS);
    const timer = setTimeout(() => {
      handleDismiss();
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.duration, toast.id, toast.type, handleDismiss]);

  const motion = `transform transition-all duration-300 ease-in-out ea-toast-in ${isExiting ? '-translate-y-4 opacity-0' : 'translate-y-0 opacity-100'}`;

  if (toast.type === 'notice') {
    // The quiet pill: one line, no icon, tap to dismiss early.
    return (
      <div
        className={`max-w-md pointer-events-auto rounded-full bg-surface-raised border border-border shadow-md px-4 py-2 text-sm text-primary inline-flex items-center gap-3 ${motion}`}
        role="status"
        aria-live="polite"
        onClick={toast.action ? undefined : handleDismiss}
      >
        <span className="min-w-0 truncate">
          <span className="font-medium">{toast.title}</span>
          {toast.message && <span className="text-tertiary"> — {toast.message}</span>}
        </span>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              handleDismiss();
            }}
            className="shrink-0 min-h-[32px] rounded-full border border-border-strong px-3 text-sm font-medium text-primary hover:bg-surface-sunken transition-colors"
          >
            {toast.action.label}
          </button>
        )}
      </div>
    );
  }

  // Sized for mobile-first: the old max-w-5xl/p-10/text-3xl toast filled a
  // phone screen edge-to-edge, and its translate-x-full entrance slid in from
  // beyond the right edge of a CENTERED container (transient horizontal
  // overflow). Now a compact card that fades/slides down from the top.
  return (
    <div
      className={`w-full max-w-md bg-surface border-2 rounded-lg shadow-lg pointer-events-auto bg-danger-soft border-danger-border ${motion}`}
      role="alert"
      aria-live="polite"
    >
      <div className="p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0 text-xl">
            <i className="fas fa-exclamation-circle text-red-500" aria-hidden="true" />
          </div>
          <div className="ml-3 w-0 flex-1 pt-0.5">
            <p className="text-base font-semibold text-primary">
              {toast.title}
            </p>
            {toast.message && (
              <p className="mt-1 text-sm text-tertiary">
                {toast.message}
              </p>
            )}
          </div>
          <button
            className="ml-2 -m-1.5 p-1.5 flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md text-faint hover:text-tertiary"
            onClick={handleDismiss}
            aria-label="Dismiss notification"
          >
            <i className="fas fa-times text-lg" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div
      className="fixed top-0 inset-x-0 z-[70] flex flex-col items-center gap-3 p-4 safe-top pointer-events-none"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

// ── Global toast store ────────────────────────────────────────────────────────
// ONE module-level store shared by every useToast() caller. The old hook kept
// per-component state, so a toast only rendered if that same component ALSO
// rendered a ToastContainer — pages did, but every embedded component
// (CreatePostModal, FollowButton, EditPostModal, …) fired toasts into the
// void. Root cause of "the app said nothing when creation failed."
// <GlobalToasts /> in the root layout renders everything now.

let globalToasts: ToastMessage[] = [];
let toastSeq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastMessage[] {
  return globalToasts;
}

function addGlobalToast(toast: Omit<ToastMessage, 'id'>): void {
  const id = `t${++toastSeq}-${Date.now()}`;
  globalToasts = [...globalToasts, { ...toast, id }];
  emit();
}

function dismissGlobalToast(id: string): void {
  globalToasts = globalToasts.filter(toast => toast.id !== id);
  emit();
}

// Hook for showing toasts. Callbacks are stable (module-level functions), so
// consumers keep them in effect dep arrays.
export function useToast() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const dismissToast = useCallback((id: string) => {
    dismissGlobalToast(id);
  }, []);

  /** Something went wrong: the card, read at leisure. */
  const showError = useCallback((title: string, message?: string) => {
    addGlobalToast({ type: 'error', title, message, duration: ERROR_MS });
  }, []);

  /** A result the user cannot see from here — sent, copied, published
   *  elsewhere, earned in the background, where a thing went. Never for a
   *  result that is on the screen. */
  const showNotice = useCallback((title: string, message?: string) => {
    addGlobalToast({ type: 'notice', title, message, duration: NOTICE_MS });
  }, []);

  /** A notice with one action — the "removed, Undo" pattern (never a confirm
   *  dialog for a reversible act). Stays a little longer. */
  const showUndo = useCallback((title: string, onUndo: () => void, message?: string) => {
    addGlobalToast({ type: 'notice', title, message, duration: UNDO_MS, action: { label: 'Undo', onClick: onUndo } });
  }, []);

  return {
    toasts,
    dismissToast,
    showError,
    showNotice,
    showUndo,
  };
}

/**
 * The ONE app-wide toast surface, mounted in the root layout. Renders the
 * global store, so a toast fired from ANY component displays. Pages must not
 * render their own <ToastContainer> anymore (it would duplicate every toast).
 */
export function GlobalToasts() {
  const { toasts, dismissToast } = useToast();
  return <ToastContainer toasts={toasts} onDismiss={dismissToast} />;
}
