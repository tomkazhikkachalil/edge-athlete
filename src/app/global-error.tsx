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
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#2563eb',
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
