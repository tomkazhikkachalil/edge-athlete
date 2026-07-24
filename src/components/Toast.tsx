'use client';

import { useState, useEffect, useCallback } from 'react';

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
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(toast.id);
    }, 300); // Match animation duration
  }, [toast.id, onDismiss]);

  useEffect(() => {
    // Show toast
    setIsVisible(true);
    
    // Auto-dismiss after duration
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
        return <i className="fas fa-info-circle text-blue-500" aria-hidden="true" />;
    }
  };

  const getBgColor = () => {
    switch (toast.type) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      case 'info':
      default:
        return 'bg-blue-50 border-blue-200';
    }
  };

  // Sized for mobile-first: the old max-w-5xl/p-10/text-3xl toast filled a
  // phone screen edge-to-edge, and its translate-x-full entrance slid in from
  // beyond the right edge of a CENTERED container (transient horizontal
  // overflow). Now a compact card that fades/slides down from the top.
  return (
    <div
      className={`
        w-full max-w-md bg-white border-2 rounded-lg shadow-lg pointer-events-auto
        transform transition-all duration-300 ease-in-out ${getBgColor()}
        ${isVisible && !isExiting ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}
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
            <p className="text-base font-semibold text-gray-900">
              {toast.title}
            </p>
            {toast.message && (
              <p className="mt-1 text-sm text-gray-600">
                {toast.message}
              </p>
            )}
          </div>
          <button
            className="ml-2 -m-1.5 p-1.5 flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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

// Hook for managing toasts.
// All callbacks are useCallback-stable: consumers put them in useEffect
// dependency arrays (e.g. the feed's realtime effect), and fresh identities
// every render caused channel teardown/resubscribe churn on each toast.
export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const showSuccess = useCallback((title: string, message?: string) => {
    addToast({ type: 'success', title, message });
  }, [addToast]);

  const showError = useCallback((title: string, message?: string) => {
    addToast({ type: 'error', title, message, duration: 6000 });
  }, [addToast]);

  const showInfo = useCallback((title: string, message?: string) => {
    addToast({ type: 'info', title, message });
  }, [addToast]);

  const showWarning = useCallback((title: string, message?: string) => {
    addToast({ type: 'warning', title, message });
  }, [addToast]);

  return {
    toasts,
    dismissToast,
    showSuccess,
    showError,
    showInfo,
    showWarning,
  };
}