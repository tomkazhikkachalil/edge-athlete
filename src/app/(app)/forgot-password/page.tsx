'use client';

import { useState } from 'react';
import Link from 'next/link';
import BrandBar from '@/components/BrandBar';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      // Rate-limit errors are worth surfacing; anything else gets the same
      // generic success so the form can't be used to probe which emails exist.
      if (resetError && /rate|too many/i.test(resetError.message)) {
        setError('Too many requests — please wait a minute and try again.');
        return;
      }
      setSent(true);
    } catch {
      setSent(true); // same generic response — never reveal account existence
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />

      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-surface rounded-lg shadow-lg p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">Reset your password</h2>

          {sent ? (
            <div>
              <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-md text-sm mb-6">
                If an account exists for <span className="font-semibold">{email.trim()}</span>, a
                password reset link is on its way. Check your inbox (and spam folder).
              </div>
              <Link href="/" className="text-brand-fg hover:text-brand-fg-strong text-sm font-medium">
                ← Back to login
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-tertiary mb-6">
                Enter the email you signed up with and we&apos;ll send you a link to set a new password.
              </p>

              {error && (
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-secondary mb-2">Email</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-3 sm:py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 text-base text-primary"
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition duration-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i> Sending…</>
                  ) : (
                    'Send reset link'
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link href="/" className="text-brand-fg hover:text-brand-fg-strong text-sm font-medium">
                  ← Back to login
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
