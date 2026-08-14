'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
    // Root-layout crashes never reach Sentry's handlers — report explicitly
    // (no-op without a DSN).
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9fafb',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          padding: '1rem',
        }}
      >
        <div
          style={{
            maxWidth: '28rem',
            width: '100%',
            backgroundColor: '#ffffff',
            borderRadius: '1rem',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#4b5563', marginBottom: '1.5rem' }}>
            The application hit an unexpected error. Please try again.
          </p>
          {process.env.NODE_ENV !== 'production' && error.message && (
            <p
              style={{
                fontSize: '0.75rem',
                textAlign: 'left',
                color: '#b91c1c',
                backgroundColor: '#fef2f2',
                border: '1px solid #fee2e2',
                borderRadius: '0.375rem',
                padding: '0.5rem',
                marginBottom: '1.5rem',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                wordBreak: 'break-all',
              }}
            >
              {error.message.length > 280 ? error.message.slice(0, 280) + '…' : error.message}
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#7c3aed',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.5rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '1rem',
              }}
            >
              Try again
            </button>
            {/* Hard navigation on purpose — the root layout is broken in
                this boundary, so router/Link are unavailable, and reset()
                alone can re-mount the same broken tree forever. */}
            <button
              type="button"
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the app shell is gone above this boundary — router/Link do not exist here
              onClick={() => window.location.assign('/')}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#ffffff',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '0.5rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '1rem',
              }}
            >
              Go home
            </button>
          </div>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '1.5rem' }}>
              Error ID: <code>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
