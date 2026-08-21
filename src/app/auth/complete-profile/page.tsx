'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import BrandBar from '@/components/BrandBar';
import HandleSelector from '@/components/HandleSelector';
import { deriveNamesFromMetadata } from '@/lib/oauth-profile';
import { FEATURE_FLAGS } from '@/lib/features';

// One-time stop for first-time OAuth users: their auth session exists but no
// profiles row does (profiles are route-created, and the handle must be set
// at creation time). Names arrive prefilled from provider metadata.
export default function CompleteProfilePage() {
  const { user, profile, loading, initialAuthCheckComplete, refreshProfile, signOut } = useAuth();
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [handle, setHandle] = useState('');
  const [dob, setDob] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [needsGuardian, setNeedsGuardian] = useState(false);
  const [parkedMessage, setParkedMessage] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [emailCollision, setEmailCollision] = useState(false);
  // Round J: which signup branch launched OAuth (OAuthButtons writes the
  // short-lived cookie before the redirect). Parents get a parent profile —
  // no handle, no DOB — instead of being silently minted as athletes.
  const [signupRole] = useState<'parent' | 'athlete'>(() => {
    try {
      if (typeof document !== 'undefined' && document.cookie.includes('ea-signup-role=parent')) {
        return 'parent';
      }
    } catch { /* cookie unreadable → athlete default */ }
    return 'athlete';
  });
  const isParent = signupRole === 'parent';
  const errorRef = useRef<HTMLDivElement>(null);

  // Route guards: unauthenticated → login; already has a profile → onward.
  useEffect(() => {
    if (loading || !initialAuthCheckComplete) return;
    if (!user) {
      router.replace('/');
    } else if (profile) {
      // Parents (097) route to the console/add-athlete, never the wizard.
      if (profile.user_type === 'parent') {
        router.replace(profile.onboarded_at ? '/app/guardian' : '/app/guardian/add-athlete');
      } else {
        router.replace(profile.onboarded_at ? '/athlete' : '/onboarding');
      }
    }
  }, [user, profile, loading, initialAuthCheckComplete, router]);

  // Prefill names from OAuth metadata once the user is known.
  // Prefill from the OAuth metadata as soon as the user is known. Render-phase
  // synchronisation, so the empty fields never paint first; `prefilled` still
  // guarantees it happens exactly once and never clobbers user edits.
  if (user && !prefilled) {
    const { firstName: f, lastName: l } = deriveNamesFromMetadata(
      user.user_metadata,
      user.email
    );
    setFirstName(f);
    setLastName(l);
    setPrefilled(true);
  }

  // Same visibility treatment as the signup form: bring errors on-screen.
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      errorRef.current.focus({ preventScroll: true });
    }
  }, [error]);

  if (loading || !initialAuthCheckComplete || !user || profile) {
    return (
      <div className="min-h-screen bg-brand-soft flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
          <p className="mt-4 text-secondary font-medium">One moment...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setEmailCollision(false);

    if (!firstName.trim()) {
      setError('Please enter your first name.');
      return;
    }
    if (!isParent && !handle) {
      setError('Please wait for your handle to be confirmed as available, or pick another handle.');
      return;
    }

    if (!isParent && FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES && !dob) {
      setError('Please enter your date of birth.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/complete-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          ...(isParent
            ? { actorRole: 'guardian' }
            : {
                handle,
                ...(FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES ? { dob } : {}),
                ...(guardianEmail ? { guardianEmail: guardianEmail.trim() } : {}),
              }),
        }),
      });
      const result = await response.json();
      if (response.status === 422 && result.needsGuardian) {
        // Under threshold (server decides): collect a guardian email.
        setNeedsGuardian(true);
        if (guardianEmail) setError(result.error);
        setSubmitting(false);
        return;
      }
      if (!response.ok) {
        setError(result.error || 'Something went wrong. Please try again.');
        setEmailCollision(response.status === 409 && /email/i.test(result.error || ''));
        setSubmitting(false);
        return;
      }
      if (result.parked) {
        setParkedMessage(result.message || "We've emailed your parent or guardian a link to finish setting up your profile.");
        setSubmitting(false);
        return;
      }
      if (isParent) {
        // Hard navigation after the session's profile changed shape — the
        // add-athlete screen must boot with the fresh parent profile.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- profile was just created server-side; the auth provider must boot fresh (house pattern)
        window.location.href = '/app/guardian/add-athlete';
        return;
      }
      await refreshProfile();
      router.replace('/onboarding');
    } catch (err) {
      console.error('Complete-profile error:', err);
      setError('An unexpected error occurred. Please try again.');
      setSubmitting(false);
    }
  };

  if (parkedMessage) {
    return (
      <div className="min-h-screen flex flex-col bg-brand-soft">
        <BrandBar hideEscape />
        <div className="flex-grow flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-surface rounded-lg shadow-lg p-6 sm:p-8 text-center">
            <i className="fas fa-envelope-circle-check text-brand-fg text-4xl mb-4"></i>
            <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">
              Check with your parent or guardian
            </h2>
            <p className="text-sm text-tertiary mb-6">{parkedMessage}</p>
            <button
              type="button"
              onClick={() => signOut()}
              className="inline-flex min-h-[44px] items-center text-sm text-brand-fg hover:underline active:underline"
            >
              Done — sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar hideEscape />
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-surface rounded-lg shadow-lg p-6 sm:p-8">
          <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-1">
            Complete your account
          </h2>
          <p className="text-sm text-tertiary mb-4">
            {isParent
              ? "You're almost in — confirm your name and you'll add your athlete next."
              : "You're almost in — confirm your name and pick a handle."}
          </p>

          {error && (
            <div
              ref={errorRef}
              role="alert"
              tabIndex={-1}
              className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4"
            >
              {error}
              {emailCollision && (
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="block mt-2 text-brand-fg hover:underline font-medium"
                >
                  Go to login
                </button>
              )}
            </div>
          )}

          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cp-first-name" className="block text-sm font-medium text-secondary mb-1">
                  First Name
                </label>
                <input
                  type="text"
                  id="cp-first-name"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                  required
                />
              </div>
              <div>
                <label htmlFor="cp-last-name" className="block text-sm font-medium text-secondary mb-1">
                  Last Name
                </label>
                <input
                  type="text"
                  id="cp-last-name"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Email</label>
              <input
                type="email"
                value={user.email ?? ''}
                disabled
                className="w-full px-4 py-3 text-sm text-muted bg-surface-sunken border border-border-strong rounded-md cursor-not-allowed"
              />
            </div>

            {FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES && !isParent && (
              <div>
                <label htmlFor="cp-dob" className="block text-sm font-medium text-secondary mb-1">
                  Date of birth
                </label>
                <input
                  type="date"
                  id="cp-dob"
                  value={dob}
                  onChange={e => setDob(e.target.value)}
                  className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                  required
                />
              </div>
            )}

            {needsGuardian && (
              <div>
                <label htmlFor="cp-guardian" className="block text-sm font-medium text-secondary mb-1">
                  Parent or guardian&apos;s email
                </label>
                <p className="text-xs text-tertiary mb-1">
                  A parent or guardian needs to finish setting up this account —
                  we&apos;ll email them a link.
                </p>
                <input
                  type="email"
                  id="cp-guardian"
                  value={guardianEmail}
                  onChange={e => setGuardianEmail(e.target.value)}
                  className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="parent@example.com"
                  required
                />
              </div>
            )}

            {!isParent && (
              <HandleSelector
                firstName={firstName}
                lastName={lastName}
                onHandleSelected={setHandle}
                required
              />
            )}

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 text-center" aria-hidden="true">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition duration-300 flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i> Setting up...
                </>
              ) : (
                <>
                  <i className="fas fa-check mr-2"></i> Continue
                </>
              )}
            </button>

            {/* Guaranteed exit: this page is the only destination for a
                signed-in, profile-less user ("/" bounces straight back
                here), so without this a persistent error would trap them. */}
            <button
              type="button"
              onClick={() => signOut()}
              className="inline-flex min-h-[44px] items-center justify-center text-sm text-muted hover:text-brand-fg hover:underline active:underline"
            >
              Sign out and return to login
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
