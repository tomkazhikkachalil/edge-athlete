'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import BrandBar from '@/components/BrandBar';
import { supabase } from '@/lib/supabase';

// Landing page for the Supabase password-recovery email link. The PKCE
// browser client exchanges the ?code= in the URL for a session automatically;
// once a session exists the user can set a new password via updateUser.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<'checking' | 'ok' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // The code exchange happens asynchronously on load. Listen for the auth
    // event AND poll getSession briefly — whichever confirms first wins.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady('ok');
      }
    });

    const checkSession = async () => {
      for (let i = 0; i < 6; i++) {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          setReady('ok');
          return;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      if (!cancelled) {
        // No session after ~3s: expired/used link, or opened in a different
        // browser than the one that requested it (PKCE requires the same one).
        setReady(prev => (prev === 'checking' ? 'invalid' : prev));
      }
    };
    checkSession();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message || 'Failed to update password. The link may have expired.');
        return;
      }
      setDone(true);
      // Session is live after recovery — take them straight into the app
      setTimeout(() => router.push('/feed'), 1500);
    } catch {
      setError('Failed to update password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-violet-50">
      <BrandBar />

      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-violet-800 mb-6">Set a new password</h2>

          {ready === 'checking' && (
            <div className="text-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600 mx-auto"></div>
              <p className="mt-3 text-sm text-gray-600">Verifying your reset link…</p>
            </div>
          )}

          {ready === 'invalid' && (
            <div>
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm mb-6">
                This reset link is invalid or has expired. Reset links are single-use and must be
                opened in the same browser you requested them from.
              </div>
              <Link
                href="/forgot-password"
                className="block w-full text-center bg-violet-600 text-white py-3 px-4 rounded-md hover:bg-violet-700 transition duration-300 font-medium"
              >
                Request a new link
              </Link>
            </div>
          )}

          {ready === 'ok' && done && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md text-sm">
              Password updated! Taking you to your feed…
            </div>
          )}

          {ready === 'ok' && !done && (
            <>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm mb-4">
                  {error}
                  {/* A submit-time failure usually means the link expired —
                      offer the way out right where the user is looking. */}
                  <Link href="/" className="block mt-2 text-violet-600 hover:underline font-medium">
                    Back to sign in
                  </Link>
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-2">
                    New password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 text-base text-gray-800"
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    minLength={6}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm new password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full px-3 py-3 sm:py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 text-base text-gray-800"
                    placeholder="Repeat your new password"
                    autoComplete="new-password"
                    minLength={6}
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-violet-600 text-white py-3 px-4 rounded-md hover:bg-violet-700 transition duration-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i> Updating…</>
                  ) : (
                    'Update password'
                  )}
                </button>
              </form>
              <p className="text-center mt-4">
                <Link href="/" className="text-sm text-violet-600 hover:underline">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
