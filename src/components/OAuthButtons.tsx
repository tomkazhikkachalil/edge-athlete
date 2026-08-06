'use client';

import { useState } from 'react';
import {
  signInWithProvider,
  googleOAuthEnabled,
  appleOAuthEnabled,
  type OAuthProvider,
} from '@/lib/oauth';

// Inline brand marks: the official multicolor Google G (FA's fab fa-google is
// monochrome) and the Apple glyph in white per Apple's HIG black button.
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width="16" height="18" viewBox="0 0 384 512" aria-hidden="true">
      <path
        fill="#ffffff"
        d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
      />
    </svg>
  );
}

interface OAuthButtonsProps {
  onError: (msg: string) => void;
  /** 'above' when buttons follow a form (login); 'below' when they precede one (signup). */
  divider?: 'above' | 'below';
}

export default function OAuthButtons({ onError, divider = 'above' }: OAuthButtonsProps) {
  const [redirecting, setRedirecting] = useState<OAuthProvider | null>(null);

  // No providers configured → render nothing (no divider, no buttons).
  if (!googleOAuthEnabled && !appleOAuthEnabled) return null;

  const start = async (provider: OAuthProvider) => {
    setRedirecting(provider);
    const { error } = await signInWithProvider(provider);
    if (error) {
      onError(error.message || 'Could not start sign-in. Please try again.');
      setRedirecting(null);
    }
    // On success the browser navigates away — leave the spinner up.
  };

  const dividerRow = (
    <div className="relative my-4">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-border-strong"></div>
      </div>
      <div className="relative flex justify-center">
        {/* Must match the form panel behind it so the divider line appears
            to pass "under" the word — surface, not literal white. The Google
            button below stays white per Google's branding rules. */}
        <span className="bg-surface px-3 text-sm text-muted">or</span>
      </div>
    </div>
  );

  return (
    <div className={divider === 'above' ? 'mt-6' : 'mt-4 mb-2'}>
      {divider === 'above' && dividerRow}
      <div className="space-y-3">
        {googleOAuthEnabled && (
          <button
            type="button"
            onClick={() => start('google')}
            disabled={redirecting !== null}
            className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 text-gray-700 py-3 px-4 rounded-md hover:bg-gray-50 transition duration-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {redirecting === 'google' ? (
              <>
                <i className="fas fa-spinner fa-spin"></i> Redirecting…
              </>
            ) : (
              <>
                <GoogleMark /> Continue with Google
              </>
            )}
          </button>
        )}
        {appleOAuthEnabled && (
          <button
            type="button"
            onClick={() => start('apple')}
            disabled={redirecting !== null}
            className="w-full flex items-center justify-center gap-3 bg-black text-white py-3 px-4 rounded-md hover:bg-gray-900 transition duration-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {redirecting === 'apple' ? (
              <>
                <i className="fas fa-spinner fa-spin"></i> Redirecting…
              </>
            ) : (
              <>
                <AppleMark /> Continue with Apple
              </>
            )}
          </button>
        )}
      </div>
      {divider === 'below' && dividerRow}
    </div>
  );
}
