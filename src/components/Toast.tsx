'use client';

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
  duration?: number;
}

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
    const duration = toast.duration || 4000;
    const timer = setTimeout(() => {
      handleDismiss();
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.duration, toast.id, handleDismiss]); // Include all dependencies

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <i className="fas fa-check-circle text-green-500" aria-hidden="true" />;
      case 'error':
        return <i className="fas fa-exclamation-circle text-red-500" aria-hidden="true" />;
      case 'warning':
        return <i className="fas fa-exclamation-triangle text-yellow-500" aria-hidden="true" />;
      case 'info':
      default:
        return <i className="fas fa-info-circle text-violet-500" aria-hidden="true" />;
    }
  };

  const getBgColor = () => {
    switch (toast.type) {
      case 'success':
        return 'bg-success-soft border-success-border';
      case 'error':
        return 'bg-danger-soft border-danger-border';
      case 'warning':
        return 'bg-warning-soft border-warning-border';
      case 'info':
      default:
        return 'bg-brand-soft border-violet-200 dark:border-violet-800';
    }
  };

  // Sized for mobile-first: the old max-w-5xl/p-10/text-3xl toast filled a
  // phone screen edge-to-edge, and its translate-x-full entrance slid in from
  // beyond the right edge of a CENTERED container (transient horizontal
  // overflow). Now a compact card that fades/slides down from the top.
  return (
    <div
      className={`
        w-full max-w-md bg-surface border-2 rounded-lg shadow-lg pointer-events-auto
        transform transition-all duration-300 ease-in-out ea-toast-in ${getBgColor()}
        ${isExiting ? '-translate-y-4 opacity-0' : 'translate-y-0 opacity-100'}
      `}
      role="alert"
      aria-live="polite"
    >
      <div className="p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0 text-xl">
            {getIcon()}
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
            className="ml-2 -m-1.5 p-1.5 flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md text-faint hover:text-tertiary focus:outline-none focus:ring-2 focus:ring-violet-500"
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

// Hook for showing toasts. Same API as always — callbacks are stable
// (module-level functions), consumers keep them in effect dep arrays.
export function useToast() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const dismissToast = useCallback((id: string) => {
    dismissGlobalToast(id);
  }, []);

  const showSuccess = useCallback((title: string, message?: string) => {
    addGlobalToast({ type: 'success', title, message });
  }, []);

  const showError = useCallback((title: string, message?: string) => {
    addGlobalToast({ type: 'error', title, message, duration: 6000 });
  }, []);

  const showInfo = useCallback((title: string, message?: string) => {
    addGlobalToast({ type: 'info', title, message });
  }, []);

  const showWarning = useCallback((title: string, message?: string) => {
    addGlobalToast({ type: 'warning', title, message });
  }, []);

  return {
    toasts,
    dismissToast,
    showSuccess,
    showError,
    showInfo,
    showWarning,
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