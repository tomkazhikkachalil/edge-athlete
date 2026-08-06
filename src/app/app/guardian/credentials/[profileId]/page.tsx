'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  // Danger zone (consent withdrawal = permanent deletion)
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen bg-brand-soft flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
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

  const expectedConfirm = (athlete?.handle || athlete?.first_name || '').toLowerCase();
  const confirmMatches =
    !!expectedConfirm &&
    deleteConfirm.trim().toLowerCase().replace(/^@/, '') === expectedConfirm;

  const handleDelete = async () => {
    setDeleteError('');
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/guardian/athletes/${profileId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmHandle: deleteConfirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setDeleteError(data.error || 'Could not delete the profile.'); return; }
      await refreshManagedProfiles();
      router.push('/athlete');
    } catch {
      setDeleteError('Could not delete the profile. Please try again.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />
      <div className="flex-grow flex flex-col items-center justify-center gap-4 p-4">
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
              <button type="button" onClick={() => router.push('/athlete')} className="text-sm text-brand-fg hover:underline">
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

        {/* Danger zone — consent withdrawal = permanent deletion */}
        <div className="w-full max-w-lg bg-surface border border-red-200 dark:border-red-800 rounded-lg p-6">
          <h3 className="text-sm font-bold text-red-700 dark:text-red-300 mb-1">Danger zone</h3>
          {!deleteOpen ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-muted">
                Withdrawing consent permanently deletes {athlete?.first_name ?? 'this athlete'}&apos;s
                profile and everything on it.
              </p>
              <button
                type="button"
                onClick={() => { setDeleteOpen(true); setDeleteConfirm(''); setDeleteError(''); }}
                className="shrink-0 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 px-3 py-2 rounded-md text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/40 transition"
              >
                Delete profile
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-secondary mb-2">
                This permanently deletes {athlete?.first_name ?? 'this athlete'}&apos;s profile,
                posts, media, and login. <span className="font-medium">It cannot be undone.</span>
              </p>
              <p className="text-xs text-muted mb-3">
                Signed consent records are retained as required for compliance.
              </p>
              {deleteError && (
                <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-3">
                  {deleteError}
                </div>
              )}
              <label htmlFor="delete-confirm" className="block text-sm font-medium text-secondary mb-1">
                Type <span className="font-mono text-red-700 dark:text-red-300">{athlete?.handle ?? athlete?.first_name ?? ''}</span> to confirm
              </label>
              <input
                type="text"
                id="delete-confirm"
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                autoComplete="off"
                className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-red-500 mb-3"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={!confirmMatches || deleteBusy}
                  className="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700 transition disabled:opacity-50"
                >
                  {deleteBusy ? <><i className="fas fa-spinner fa-spin mr-2"></i>Deleting...</> : 'Permanently delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleteBusy}
                  className="border border-border-strong text-secondary px-4 py-2 rounded-md text-sm font-medium hover:bg-surface-muted transition disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
