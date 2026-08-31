'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import BrandBar from '@/components/BrandBar';
import {
  MESSAGING_OPTIONS,
  type Visibility,
  type MessagingPermission,
} from '@/lib/profile-privacy';

// ── Post-transfer activation + review ────────────────────────────────────────
// The link from the "your account is now yours" email. Three beats, one page:
// set a password (auto signed-in) → one review card with safe defaults →
// their profile. Closing the tab mid-review is fine: the server already
// stamped onboarded_at and the restrictive defaults (private / nobody)
// simply stay in place.

export default function ActivatePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [state, setState] = useState<'loading' | 'invalid' | 'password' | 'review'>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsManualLogin, setNeedsManualLogin] = useState(false);
  const [guardianAccess, setGuardianAccess] = useState<'viewer' | 'removed' | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [messaging, setMessaging] = useState<MessagingPermission>('nobody');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invites/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setState(res.ok && data.valid && data.inviteType === 'athlete_activation' ? 'password' : 'invalid');
      } catch {
        if (!cancelled) setState('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError("Those passwords don't match."); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 410) { setState('invalid'); return; }
      if (!res.ok) { setError(data.error || 'Something went wrong. Please try again.'); return; }
      setGuardianAccess(data.guardianAccess ?? null);
      if (!data.signedIn) { setNeedsManualLogin(true); return; }
      setState('review');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleDone = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileData: { visibility, messaging_permission: messaging },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save your choices. Please try again.');
        setBusy(false);
        return;
      }
      // Hard reload, not router.push: the session cookies were set by the
      // activate API mid-page, so the auth provider must boot fresh to see
      // them (same pattern as username login on the home page).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- session cookies were set mid-page; the auth provider must boot fresh
      window.location.href = '/athlete';
    } catch {
      setError('Could not save your choices. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-surface rounded-lg shadow-lg p-6 sm:p-8">
          {state === 'loading' && (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
            </div>
          )}

          {state === 'invalid' && (
            <div className="text-center py-6">
              <i className="fas fa-link-slash text-brand-fg text-4xl mb-4"></i>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">
                This activation link has expired or was already used
              </h2>
              <p className="text-sm text-tertiary max-w-md mx-auto mb-6">
                Don&apos;t worry — your account is still yours. You can sign in any
                time by resetting your password with your new email address.
              </p>
              <button
                type="button"
                onClick={() => router.push('/forgot-password')}
                className="w-full max-w-xs mx-auto bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition text-sm font-medium block"
              >
                Reset my password
              </button>
            </div>
          )}

          {state === 'password' && needsManualLogin && (
            <div className="text-center py-6">
              <i className="fas fa-circle-check text-brand-fg text-4xl mb-4"></i>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">Password set!</h2>
              <p className="text-sm text-tertiary max-w-md mx-auto mb-6">
                Please sign in with your email and new password.
              </p>
              <button
                type="button"
                onClick={() => router.push('/')}
                className="w-full max-w-xs mx-auto bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition text-sm font-medium block"
              >
                Go to sign in
              </button>
            </div>
          )}

          {state === 'password' && !needsManualLogin && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-1">Welcome to your account</h2>
              <p className="text-sm text-tertiary mb-6">
                It&apos;s officially yours. Set a password to get started.
              </p>
              {error && (
                <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4">
                  {error}
                </div>
              )}
              <form onSubmit={handleSetPassword} className="flex flex-col gap-4">
                <div>
                  <label htmlFor="new-password" className="block text-sm font-medium text-secondary mb-1">
                    New password
                  </label>
                  <input
                    type="password"
                    id="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    minLength={6}
                    required
                    autoComplete="new-password"
                    className="w-full border border-border-strong rounded-md px-4 py-3 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-medium text-secondary mb-1">
                    Confirm password
                  </label>
                  <input
                    type="password"
                    id="confirm-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    minLength={6}
                    required
                    autoComplete="new-password"
                    className="w-full border border-border-strong rounded-md px-4 py-3 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition flex items-center justify-center text-sm font-medium disabled:opacity-50"
                >
                  {busy ? <><i className="fas fa-spinner fa-spin mr-2"></i> Setting up...</> : 'Set password & continue'}
                </button>
              </form>
            </>
          )}

          {state === 'review' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-1">Your account, your rules</h2>
              <p className="text-sm text-tertiary mb-6">
                One quick look at who can see and contact you. These are your
                current settings — keep them or change them, then you&apos;re done.
              </p>
              {error && (
                <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4">
                  {error}
                </div>
              )}

              <fieldset className="mb-5">
                <legend className="text-sm font-semibold text-primary mb-2">Who can see your profile</legend>
                {([
                  { value: 'private', label: 'Private', description: 'Only people you approve can see your profile.' },
                  { value: 'public', label: 'Public', description: 'Anyone can find and view your profile.' },
                ] as const).map(opt => (
                  <label key={opt.value} className="flex items-start gap-3 py-2 cursor-pointer">
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === opt.value}
                      onChange={() => setVisibility(opt.value)}
                      className="mt-1 accent-violet-600"
                    />
                    <span className="text-sm">
                      <span className="text-primary font-medium">{opt.label}</span>
                      <span className="block text-muted">{opt.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <fieldset className="mb-5">
                <legend className="text-sm font-semibold text-primary mb-2">Who can message you</legend>
                {MESSAGING_OPTIONS.map(opt => (
                  <label key={opt.value} className="flex items-start gap-3 py-2 cursor-pointer">
                    <input
                      type="radio"
                      name="messaging"
                      checked={messaging === opt.value}
                      onChange={() => setMessaging(opt.value)}
                      className="mt-1 accent-violet-600"
                    />
                    <span className="text-sm">
                      <span className="text-primary font-medium">{opt.label}</span>
                      <span className="block text-muted">{opt.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {guardianAccess && (
                <p className="text-xs text-muted bg-surface-muted border border-border rounded-md px-4 py-3 mb-5">
                  {guardianAccess === 'viewer'
                    ? 'Your former guardian can still view your profile (view-only — they can no longer manage anything).'
                    : 'Your former guardian no longer has access to your account.'}
                </p>
              )}

              <button
                type="button"
                onClick={handleDone}
                disabled={busy}
                className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition flex items-center justify-center text-sm font-medium disabled:opacity-50"
              >
                {busy ? <><i className="fas fa-spinner fa-spin mr-2"></i> Saving...</> : 'Done'}
              </button>
              <p className="text-xs text-muted text-center mt-3">
                You can change any of this later in Settings.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
