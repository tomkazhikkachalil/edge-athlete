'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import BrandBar from '@/components/BrandBar';
import { useAuth } from '@/lib/auth';

// ── /athlete-claim/[token] — take ownership of a stub athlete (R3) ──────────
// The org-claim page shape (BrandBar, string-union machine, non-dead-end
// terminals) with the TWO-PATH chooser: "This is me" = the ACCOUNTLESS
// adult claim (email + password, works signed-out; a signed-in visitor is
// told they'll be signed in AS the athlete); "I'm their parent or
// guardian" = the signed-in guardian claim. Signed-out guardians are told
// to sign in and reopen the link — a deliberate scope cut (the URL is
// durable for 30 days), the parked-banner wiring exists if ever wanted.

type State =
  | 'loading'
  | 'invalid'
  | 'ready'
  | 'self-form'
  | 'claiming'
  | 'claimed-self'
  | 'claimed-guardian'
  | 'conflict';

export default function AthleteClaimPage() {
  const params = useParams();
  const token = params.token as string;
  const { user, initialAuthCheckComplete } = useAuth();

  const [state, setState] = useState<State>('loading');
  const [athleteName, setAthleteName] = useState('');
  const [orgLine, setOrgLine] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/athlete-claim/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.valid) {
          setAthleteName(data.athleteName ?? 'This athlete');
          setOrgLine(
            [data.teamName, data.orgName].filter(Boolean).join(' at ') || 'an organization'
          );
          setState('ready');
        } else {
          setState('invalid');
        }
      } catch {
        if (!cancelled) setState('invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const post = async (body: Record<string, string>) => {
    setState('claiming');
    setError('');
    try {
      const res = await fetch(`/api/athlete-claim/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setState(data.mode === 'guardian' ? 'claimed-guardian' : 'claimed-self');
        return;
      }
      if (res.status === 410) {
        setState('invalid');
        return;
      }
      if (res.status === 409) {
        setError(data.error || 'This profile can no longer be claimed this way.');
        setState('conflict');
        return;
      }
      setError(data.error || 'Could not complete the claim');
      setState(body.mode === 'self' ? 'self-form' : 'ready');
    } catch {
      setError('Could not complete the claim');
      setState(body.mode === 'self' ? 'self-form' : 'ready');
    }
  };

  const card = 'w-full max-w-lg bg-surface rounded-lg shadow-lg p-6 sm:p-8';
  const primaryBtn =
    'w-full px-5 py-2.5 min-h-[44px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-60';
  const secondaryBtn =
    'w-full px-5 py-2.5 min-h-[44px] rounded-lg border border-border-strong text-secondary font-medium hover:bg-surface-sunken transition-colors';

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className={card}>
          {state === 'loading' && (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
            </div>
          )}

          {state === 'invalid' && (
            <div className="text-center">
              <h1 className="text-xl font-bold text-primary mb-2">
                This link has expired or was already used
              </h1>
              <p className="text-sm text-tertiary mb-4">
                Ask the organization that rostered you for a fresh link.
              </p>
              <Link href="/" className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
                Go to Edge Athlete →
              </Link>
            </div>
          )}

          {state === 'conflict' && (
            <div className="text-center">
              <h1 className="text-xl font-bold text-primary mb-2">Almost — but not this way</h1>
              {error && (
                <p role="alert" className="text-sm text-secondary mb-4">
                  {error}
                </p>
              )}
              <Link href="/" className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
                Go to Edge Athlete →
              </Link>
            </div>
          )}

          {(state === 'ready' || state === 'claiming') && (
            <div className="text-center">
              <div className="w-14 h-14 bg-brand-soft rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-user-check text-xl text-brand-fg" aria-hidden="true"></i>
              </div>
              <h1 className="text-xl font-bold text-primary mb-1">{athleteName}</h1>
              <p className="text-sm text-muted mb-2">was rostered on {orgLine}</p>
              <p className="text-sm text-secondary mb-4">
                This profile was created by the organization. Claim it to make it real —
                the roster spot, team schedule, and history come with it.
              </p>
              {error && (
                <p role="alert" className="text-sm text-red-600 mb-3">
                  {error}
                </p>
              )}
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={state === 'claiming'}
                  onClick={() => setState('self-form')}
                  className={primaryBtn}
                >
                  This is me — I&apos;m {athleteName}
                </button>
                {!initialAuthCheckComplete ? null : user ? (
                  <button
                    type="button"
                    disabled={state === 'claiming'}
                    onClick={() => void post({ mode: 'guardian' })}
                    className={secondaryBtn}
                  >
                    I&apos;m their parent or guardian
                  </button>
                ) : (
                  <p className="text-xs text-muted pt-1">
                    A parent or guardian?{' '}
                    <Link href="/" className="text-brand-fg font-medium">
                      Sign in
                    </Link>{' '}
                    first, then open this link again — it works for 30 days.
                  </p>
                )}
              </div>
            </div>
          )}

          {state === 'self-form' && (
            <div>
              <button
                type="button"
                onClick={() => setState('ready')}
                className="text-sm text-brand-fg hover:text-brand-fg-strong mb-3"
              >
                ← Back
              </button>
              <h1 className="text-xl font-bold text-primary mb-1">Make this profile yours</h1>
              <p className="text-sm text-tertiary mb-4">
                Set the email and password you&apos;ll sign in with.
                {user ? " You'll be signed in as this athlete." : ''}
              </p>
              {error && (
                <p role="alert" className="text-sm text-red-600 mb-3">
                  {error}
                </p>
              )}
              <div className="space-y-3">
                <div>
                  <label htmlFor="claim-email" className="block text-sm font-medium text-secondary mb-1">
                    Email
                  </label>
                  <input
                    id="claim-email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="claim-password" className="block text-sm font-medium text-secondary mb-1">
                    Password
                  </label>
                  <input
                    id="claim-password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={!email.trim() || password.length < 6}
                  onClick={() => void post({ mode: 'self', email: email.trim(), password })}
                  className={primaryBtn}
                >
                  Claim my profile
                </button>
              </div>
            </div>
          )}

          {state === 'claimed-self' && (
            <div className="text-center">
              <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-950/40 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-circle-check text-xl text-emerald-600" aria-hidden="true"></i>
              </div>
              <h1 className="text-xl font-bold text-primary mb-2">The profile is yours</h1>
              <p className="text-sm text-tertiary mb-4">
                Your roster spot and team schedule are already on it.
              </p>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate
                  hard navigation: the claim just SET session cookies server-side, and a
                  client-side <Link> would carry the stale signed-out auth context. */}
              <a href="/athlete" className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
                Go to your profile →
              </a>
            </div>
          )}

          {state === 'claimed-guardian' && (
            <div className="text-center">
              <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-950/40 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-people-roof text-xl text-emerald-600" aria-hidden="true"></i>
              </div>
              <h1 className="text-xl font-bold text-primary mb-2">
                {athleteName} is in your family console
              </h1>
              <p className="text-sm text-tertiary mb-4">
                You manage their profile now — set up their login whenever they&apos;re ready.
              </p>
              <Link
                href="/app/guardian"
                className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium"
              >
                Open the Family Console →
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
