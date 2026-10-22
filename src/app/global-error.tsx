'use client';

import { useEffect, useSyncExternalStore } from 'react';
import * as Sentry from '@sentry/nextjs';
import { THEME_RESOLVED_COOKIE } from '@/lib/theme-cookie';

// This boundary REPLACES the root layout, so neither the stylesheet nor the
// theme script reaches it — it used to be a white screen for a dark-theme
// user. It reads the resolved theme the app last wrote (the cookie the
// manifest also reads) and paints the matching hexes of globals.css by hand.
const PALETTE = {
  light: { canvas: '#f9fafb', surface: '#ffffff', primary: '#111827', secondary: '#374151', tertiary: '#4b5563', faint: '#676e7c', border: '#d1d5db', dangerFg: '#b91c1c', dangerSoft: '#fef2f2', dangerBorder: '#fee2e2' },
  dark: { canvas: '#171310', surface: '#1f1a16', primary: '#e9e5e1', secondary: '#c8c1ba', tertiary: '#a9a29b', faint: '#948e88', border: '#4a423b', dangerFg: '#f87171', dangerSoft: '#2e1a18', dangerBorder: '#5e2d2a' },
} as const;

const noSubscribe = () => () => {};

function resolvedTheme(): keyof typeof PALETTE {
  if (typeof document === 'undefined') return 'light';
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${THEME_RESOLVED_COOKIE}=([^;]*)`));
  return m?.[1] === 'dark' ? 'dark' : 'light';
}

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
  // A server render paints light; the client re-reads the cookie after
  // hydration with no mismatch (the server snapshot is the light one).
  const theme = useSyncExternalStore(noSubscribe, resolvedTheme, () => 'light' as const);
  const c = PALETTE[theme];

  return (
    <html lang="en" style={{ colorScheme: theme === 'dark' ? 'only dark' : 'only light' }}>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.canvas,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          padding: '1rem',
        }}
      >
        <div
          style={{
            maxWidth: '28rem',
            width: '100%',
            backgroundColor: c.surface,
            borderRadius: '1rem',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: c.primary, marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: c.tertiary, marginBottom: '1.5rem' }}>
            The application hit an unexpected error. Please try again.
          </p>
          {process.env.NODE_ENV !== 'production' && error.message && (
            <p
              style={{
                fontSize: '0.75rem',
                textAlign: 'left',
                color: c.dangerFg,
                backgroundColor: c.dangerSoft,
                border: `1px solid ${c.dangerBorder}`,
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
                backgroundColor: c.surface,
                color: c.secondary,
                border: `1px solid ${c.border}`,
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
            <p style={{ fontSize: '0.75rem', color: c.faint, marginTop: '1.5rem' }}>
              Error ID: <code>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
