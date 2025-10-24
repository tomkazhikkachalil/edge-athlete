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

  return (
    <div
      className={`
        max-w-5xl w-full bg-white border-2 rounded-lg shadow-lg pointer-events-auto
        transform transition-all duration-300 ease-in-out ${getBgColor()}
        ${isVisible && !isExiting ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
      role="alert"
      aria-live="polite"
    >
      <div className="p-10">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <div className="text-3xl">
              {getIcon()}
            </div>
          </div>
          <div className="ml-6 w-0 flex-1 pt-1">
            <p className="text-lg font-semibold text-gray-900">
              {toast.title}
            </p>
            {toast.message && (
              <p className="mt-2 text-base text-gray-600">
                {toast.message}
              </p>
            )}
          </div>
          <div className="ml-6 flex-shrink-0 flex">
            <button
              className="bg-white rounded-md inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              onClick={handleDismiss}
              aria-label="Dismiss notification"
            >
              <i className="fas fa-times text-lg" aria-hidden="true" />
            </button>
          </div>
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
      className="fixed top-0 left-1/2 -translate-x-1/2 z-50 p-6 space-y-4 pointer-events-none"
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

// Hook for managing toasts
export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { ...toast, id }]);
  };

  const dismissToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  const showSuccess = (title: string, message?: string) => {
    addToast({ type: 'success', title, message });
  };

  const showError = (title: string, message?: string) => {
    addToast({ type: 'error', title, message, duration: 6000 });
  };

  const showInfo = (title: string, message?: string) => {
    addToast({ type: 'info', title, message });
  };

  const showWarning = (title: string, message?: string) => {
    addToast({ type: 'warning', title, message });
  };

  return {
    toasts,
    dismissToast,
    showSuccess,
    showError,
    showInfo,
    showWarning,
  };
}