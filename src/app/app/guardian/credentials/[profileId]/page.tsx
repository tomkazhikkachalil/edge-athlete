'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import BrandBar from '@/components/BrandBar';
import { FEATURE_FLAGS } from '@/lib/features';

// Guardian issues/resets the child's login (Phase 4): username is the
// child's handle; secret is a password or a 4–6 digit PIN (younger kids).
// Setting it signs the child out everywhere else — hand the new one over
// in person. "Forgot password" for the child is exactly this screen.
export default function CredentialsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete, managedProfiles, refreshManagedProfiles } = useAuth();
  const profileId = params.profileId as string;
  const athlete = managedProfiles.find(p => p.id === profileId);

  const [mode, setMode] = useState<'password' | 'pin'>('password');
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [issued, setIssued] = useState<{ username: string; mode: string } | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Round D: managedProfiles fills in AFTER auth completes, so "not in the
  // list" only means "not yours" once a fresh load has finished. Before this
  // guard, a bogus/foreign profileId rendered the form with placeholder copy
  // and a delete confirm that could never match.
  const [rosterReady, setRosterReady] = useState(false);

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        await refreshManagedProfiles();
      } finally {
        if (!cancelled) setRosterReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, refreshManagedProfiles]);

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user || !rosterReady) {
    return (
      <div className="min-h-screen bg-brand-soft flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  if (!athlete) {
    return (
      <div className="min-h-screen flex flex-col bg-brand-soft">
        <BrandBar />
        <div className="flex-grow flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-surface rounded-lg shadow-lg p-6 sm:p-8 text-center">
            <h2 className="text-xl font-bold text-primary mb-2">Not one of your athletes</h2>
            <p className="text-sm text-tertiary mb-4">
              This profile isn&apos;t managed by your account.
            </p>
            <Link
              href="/app/guardian"
              className="inline-flex items-center px-4 py-2 min-h-[44px] bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover"
            >
              Back to the console
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (secret !== confirm) { setError("They don't match — please re-enter."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/guardian/athletes/${profileId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, secret }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not set the login.'); return; }
      setIssued({ username: data.username, mode: data.mode });
      setSecret(''); setConfirm('');
    } catch {
      setError('Could not set the login. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />
      <div className="flex-grow flex flex-col items-center justify-center gap-3 p-4">
        <div className="w-full max-w-lg">
        <Link
          href="/app/guardian"
          className="self-start inline-flex items-center gap-2 text-sm font-semibold text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300 min-h-[44px]"
        >
          <i className="fas fa-chevron-left text-xs"></i>
          Family console
        </Link>
        </div>
        <div className="w-full max-w-lg bg-surface rounded-lg shadow-lg p-6 sm:p-8">
          {issued ? (
            <div className="text-center py-4">
              <i className="fas fa-key text-brand-fg text-4xl mb-4"></i>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">Login ready</h2>
              <p className="text-sm text-tertiary mb-4">
                Share these with your athlete in person:
              </p>
              <div className="bg-brand-soft border border-violet-100 dark:border-violet-900 rounded-md p-4 mb-6 text-left">
                <p className="text-sm text-primary"><span className="font-medium">Username:</span> {issued.username}</p>
                <p className="text-sm text-primary mt-1">
                  <span className="font-medium">{issued.mode === 'pin' ? 'PIN' : 'Password'}:</span> the one you just set
                </p>
              </div>
              <p className="text-xs text-muted mb-6">
                They sign in with the username on the normal login screen — no
                email needed. If they ever forget it, come back here and set a
                new one (their other sessions are signed out automatically).
              </p>
              <button type="button" onClick={() => router.push('/athlete')} className="inline-flex min-h-[44px] items-center text-sm text-brand-fg hover:underline active:underline">
                Done
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-1">
                Set up {athlete ? `${athlete.first_name}'s` : 'their'} login
              </h2>
              <p className="text-sm text-tertiary mb-4">
                Their username is <span className="font-medium">{athlete?.handle ?? 'their handle'}</span>.
                Choose a password — or a simple 4–6 digit PIN for younger kids.
              </p>
              {error && (
                <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4">
                  {error}
                </div>
              )}
              <div className="flex gap-2 mb-4">
                {(['password', 'pin'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMode(m); setSecret(''); setConfirm(''); setError(''); }}
                    className={`px-4 py-2 rounded-md text-sm font-medium border ${
                      mode === m
                        ? 'bg-brand text-white border-brand'
                        : 'bg-surface text-secondary border-border-strong hover:border-violet-400'
                    }`}
                  >
                    {m === 'pin' ? 'PIN (ages ~6–9)' : 'Password'}
                  </button>
                ))}
              </div>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label htmlFor="cred-secret" className="block text-sm font-medium text-secondary mb-1">
                    {mode === 'pin' ? 'PIN (4–6 digits)' : 'Password (6+ characters)'}
                  </label>
                  <input
                    type={mode === 'pin' ? 'tel' : 'password'}
                    id="cred-secret"
                    value={secret}
                    onChange={e => setSecret(e.target.value)}
                    inputMode={mode === 'pin' ? 'numeric' : undefined}
                    pattern={mode === 'pin' ? '[0-9]{4,6}' : undefined}
                    minLength={mode === 'pin' ? 4 : 6}
                    maxLength={mode === 'pin' ? 6 : undefined}
                    className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="cred-confirm" className="block text-sm font-medium text-secondary mb-1">
                    Confirm {mode === 'pin' ? 'PIN' : 'password'}
                  </label>
                  <input
                    type={mode === 'pin' ? 'tel' : 'password'}
                    id="cred-confirm"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    inputMode={mode === 'pin' ? 'numeric' : undefined}
                    className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition duration-300 flex items-center justify-center text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i> Setting up...</>
                  ) : (
                    'Set their login'
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        {/* Round J: the danger zone lives on the athlete management page
            (Round D moved it there) — this page kept a full second copy,
            leaving two places to permanently delete a child. One door now. */}
        <p className="text-xs text-muted">
          Need to withdraw consent and delete this profile? That lives on{' '}
          <Link
            href={`/app/guardian/athlete/${profileId}`}
            className="text-brand-fg hover:underline font-medium"
          >
            {athlete?.first_name ?? 'the athlete'}&apos;s management page
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
