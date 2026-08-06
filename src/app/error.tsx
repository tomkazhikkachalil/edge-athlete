'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Route error:', error);
    // Error boundaries swallow the error before Sentry's global handler
    // sees it — report explicitly (no-op without a DSN).
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-4">
      <div className="max-w-md w-full bg-surface rounded-2xl shadow-lg p-8 text-center">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-950/60 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-8 h-8 text-red-600 dark:text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.33 16a2 2 0 001.74 3z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-primary mb-2">Something went wrong</h1>
        <p className="text-tertiary mb-6">
          We hit an unexpected error. You can try again, or head back to the home page.
        </p>
        {process.env.NODE_ENV !== 'production' && error.message && (
          <p className="text-xs text-left text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 rounded-md p-2 mb-6 font-mono break-all">
            {error.message.length > 280 ? error.message.slice(0, 280) + '…' : error.message}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={reset}
            className="px-6 py-3 bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover transition-colors"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            className="px-6 py-3 bg-surface-sunken text-primary rounded-lg font-semibold hover:bg-gray-200 dark:hover:bg-stone-800 transition-colors"
          >
            Go home
          </button>
        </div>
        {error.digest && (
          <p className="text-xs text-faint mt-6">
            Error ID: <code className="font-mono">{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
