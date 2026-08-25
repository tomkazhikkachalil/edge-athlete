'use client';

import { useState, useEffect, useRef } from 'react';
import * as Sentry from '@sentry/nextjs';
import HandleSelector from '@/components/HandleSelector';
import OAuthButtons from '@/components/OAuthButtons';
import InviteLinkShare from '@/components/InviteLinkShare';
import { loadParkedInvite, saveParkedInvite, clearParkedInvite } from '@/lib/parked-invite';
import { isValidDateString, isNotFutureDate } from '@/lib/date-validation';

// Registration step machine (guardian-profiles feature).
//
// Step order is a compliance/UX requirement, not a style choice:
//   1. 'role'    — "Who's setting this up?" FIRST — a DOB is meaningless
//                  until you know whose birthday you're asking about (a
//                  parent would enter their child's DOB and trip the minor
//                  gate before the system learns an adult is present).
//   2. 'dob'     — branch-worded ("Your date of birth" vs "Your athlete's
//                  date of birth"), NEUTRAL: never state or hint at any age
//                  threshold before collecting it.
//   3a. athlete → 'details' form → server may answer 422 needsGuardian
//                  (under-threshold) → 'guardian' email step → 'parked'.
//   3b. parent  → 'parent' Step A: minimal own-account form (name, email,
//                  password ONLY — no athlete fields) → 'parent-done'
//                  ("Add your athlete" happens from their account: Step B).
//
// Routing is server-enforced (/api/signup actorRole guard); this UI never
// computes ages locally, so it can't leak the threshold either.

type Step = 'role' | 'dob' | 'details' | 'parent' | 'parent-done' | 'guardian' | 'parked';
type Role = 'athlete' | 'parent';

const inputClass =
  'w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500';
const labelClass = 'block text-sm font-medium text-secondary mb-1';
const primaryBtn =
  'w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition duration-300 flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';

const HANDLE_CHECKING_MSG = 'Checking your handle — one moment…';
const HANDLE_WAIT_MSG =
  'Please wait for your handle to be confirmed as available, or pick another handle.';

export default function RegistrationSteps({ onBackToLogin }: { onBackToLogin: () => void }) {
  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<Role>('athlete');
  const [dob, setDob] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [parkedMessage, setParkedMessage] = useState('');
  const [parkedInviteUrl, setParkedInviteUrl] = useState<string | null>(null);

  // Rehydrate a parked screen lost to refresh (dummy-proofing round). An
  // effect + macrotask, not a lazy initializer: localStorage differs from
  // the SSR render (hydration mismatch), and the deferred callback keeps
  // the setState out of the effect body (set-state-in-effect).
  useEffect(() => {
    const timer = setTimeout(() => {
      const stored = loadParkedInvite();
      if (!stored) return;
      setParkedMessage(stored.message);
      setParkedInviteUrl(stored.inviteUrl);
      setStep('parked');
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const [form, setForm] = useState({
    firstName: '', lastName: '', nickname: '', email: '', phone: '',
    gender: '', location: '', postalCode: '', password: '', confirmPassword: '',
    handle: '',
  });
  const [error, setError] = useState('');
  // Handle-check race machinery: a submit while the availability check is
  // pending (the 500ms debounce window INCLUDED) waits and auto-continues
  // when the check lands, instead of erroring at the user. Event-driven —
  // no effects (set-state-in-effect is a lint error); the single-flight
  // shape follows WorkoutEditorScreen's inFlight/pending refs.
  const handleCheckingRef = useRef(false);
  const pendingSubmitRef = useRef(false);
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      errorRef.current.focus({ preventScroll: true });
    }
  }, [error]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const submitDob = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!dob || !isValidDateString(dob) || !isNotFutureDate(dob)) {
      setError('Please enter a valid date of birth.');
      return;
    }
    if (new Date(dob).getFullYear() < 1900) {
      setError('Please double-check the year.');
      return;
    }
    // Parent branch: the DOB collected is the ATHLETE's (held for the
    // add-your-athlete step) — it never gates the parent's own signup.
    setStep(role === 'parent' ? 'parent' : 'details');
  };

  const submitParentAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!form.email || !form.password || !form.firstName || !form.lastName) {
      setError('Please fill in all required fields');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          actorRole: 'guardian',
          profileData: {
            first_name: form.firstName,
            last_name: form.lastName,
            user_type: 'athlete',
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || 'An error occurred during registration');
        return;
      }
      // Hand the athlete's DOB (collected at step 2) to the post-login
      // "Add your athlete" screen. With auto sign-in below this is a
      // same-session hand-off, so it actually survives now.
      try { window.sessionStorage.setItem('ea:athlete-dob', dob); } catch {}

      // Round J: sign the parent straight in (email confirmations are OFF in
      // this project, so the credentials work immediately) and land them on
      // Add-your-athlete. Hard navigation, not router.push — the house rule
      // after a session change (cookies must be re-read server-side). If the
      // sign-in fails for any reason (e.g. confirmations get turned on
      // later), fall back to the old "Sign in to continue" screen.
      try {
        const { supabase } = await import('@/lib/supabase');
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (!signInError) {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a session was just created; the auth provider must boot fresh (house pattern)
          window.location.href = '/app/guardian/add-athlete';
          return;
        }
      } catch { /* fall through to the manual sign-in screen */ }
      setStep('parent-done');
    } catch (err) {
      console.error('Parent registration error:', err);
      Sentry.captureException(err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitAccount = async (withGuardianEmail?: string, handleOverride?: string) => {
    setError('');
    // handleOverride: the auto-continued submit fires from the same event
    // that delivered the confirmed handle — form state hasn't re-rendered
    // yet, so the fresh value rides in explicitly.
    const confirmedHandle = handleOverride ?? form.handle;
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!confirmedHandle) {
      if (handleCheckingRef.current) {
        // Wait for the in-flight check; onHandleSelected auto-continues.
        pendingSubmitRef.current = true;
        setError(HANDLE_CHECKING_MSG);
        return;
      }
      setError(HANDLE_WAIT_MSG);
      return;
    }
    if (!form.email || !form.password || !form.firstName || !form.lastName) {
      setError('Please fill in all required fields');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          ...(withGuardianEmail ? { guardianEmail: withGuardianEmail } : {}),
          profileData: {
            first_name: form.firstName,
            last_name: form.lastName,
            nickname: form.nickname,
            phone: form.phone,
            birthday: dob,
            gender: form.gender as 'male' | 'female' | 'custom',
            location: form.location,
            postal_code: form.postalCode,
            user_type: 'athlete',
            handle: confirmedHandle,
          },
        }),
      });
      const result = await response.json();
      if (response.status === 422 && result.needsGuardian) {
        // Under threshold — collect a guardian email (server decides; the
        // UI never computes ages).
        setStep('guardian');
        if (withGuardianEmail) setError(result.error);
        return;
      }
      if (!response.ok) {
        setError(result.error || 'An error occurred during registration');
        if (step === 'guardian') return;
        return;
      }
      if (result.parked) {
        setParkedMessage(result.message);
        setParkedInviteUrl(result.inviteUrl ?? null);
        // Persist (dummy-proofing round): this screen is the minor's ONLY
        // surface and the link their only channel — it must survive a
        // refresh/back-tap. Cleared on the EXPLICIT back-to-login below.
        saveParkedInvite({ message: result.message ?? '', inviteUrl: result.inviteUrl ?? null });
        setStep('parked');
        return;
      }
      // Same Round-J treatment the parent branch gets: sign the athlete
      // straight in (email confirmations are OFF, so the credentials work
      // immediately) and land them in onboarding. Hard navigation, not
      // router.push — the house rule after a session change. If the sign-in
      // fails (e.g. confirmations get turned on later), fall back to the old
      // "Please sign in" hand-off.
      try {
        const { supabase } = await import('@/lib/supabase');
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (!signInError) {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a session was just created; the auth provider must boot fresh (house pattern)
          window.location.href = '/onboarding';
          return;
        }
      } catch { /* fall through to the manual sign-in screen */ }
      setSuccess('Account created successfully! Please sign in to continue.');
      setTimeout(onBackToLogin, 2000);
    } catch (err) {
      console.error('Registration error:', err);
      Sentry.captureException(err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const errorBox = error && (
    <div
      ref={errorRef}
      role="alert"
      tabIndex={-1}
      className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4"
    >
      {error}
    </div>
  );

  return (
    <div className="flex-grow flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-surface rounded-lg shadow-lg overflow-hidden">
        <div className="w-full p-6 sm:p-8">
          {step === 'role' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-1">Who&apos;s setting this up?</h2>
              <p className="text-sm text-tertiary mb-4">This helps us set up the right kind of account.</p>
              {errorBox}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
                <button
                  type="button"
                  onClick={() => { setRole('athlete'); setStep('dob'); }}
                  className="border-2 border-violet-200 dark:border-violet-800 hover:border-brand rounded-lg p-6 text-left transition"
                >
                  <i className="fas fa-person-running text-brand-fg text-2xl mb-2"></i>
                  <p className="font-bold text-primary">I&apos;m the athlete</p>
                  <p className="text-sm text-tertiary mt-1">This account is for me.</p>
                </button>
                <button
                  type="button"
                  onClick={() => { setRole('parent'); setStep('dob'); }}
                  className="border-2 border-violet-200 dark:border-violet-800 hover:border-brand rounded-lg p-6 text-left transition"
                >
                  <i className="fas fa-user-shield text-brand-fg text-2xl mb-2"></i>
                  <p className="font-bold text-primary">I&apos;m a parent or guardian</p>
                  <p className="text-sm text-tertiary mt-1">I&apos;m setting this up for my athlete.</p>
                </button>
              </div>
              <button type="button" onClick={onBackToLogin} className="inline-flex min-h-[44px] items-center mt-4 text-xs text-brand-fg hover:underline active:underline">
                Back to login
              </button>
            </>
          )}

          {step === 'dob' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-1">
                {role === 'parent' ? "Your athlete's date of birth" : 'Your date of birth'}
              </h2>
              <p className="text-sm text-tertiary mb-4">
                {role === 'parent'
                  ? 'This helps us set up their profile correctly.'
                  : 'This helps us set up your account correctly.'}
              </p>
              {errorBox}
              <form onSubmit={submitDob} className="flex flex-col gap-4 max-w-sm">
                <div>
                  <label htmlFor="reg-dob" className={labelClass}>Date of birth</label>
                  <input
                    type="date"
                    id="reg-dob"
                    value={dob}
                    onChange={e => setDob(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>
                <button type="submit" className={primaryBtn}>Continue</button>
                <button type="button" onClick={() => setStep('role')} className="inline-flex min-h-[44px] items-center text-xs text-brand-fg hover:underline active:underline">
                  Back
                </button>
              </form>
            </>
          )}

          {step === 'parent' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-1">Create your account</h2>
              <p className="text-sm text-tertiary mb-4">
                Quick and simple — just you for now. You&apos;ll add your athlete right after.
              </p>
              {/* Round J: the parent branch gets OAuth too — the signupRole
                  cookie tells complete-profile to create a PARENT profile
                  (it used to hardcode athlete). */}
              <OAuthButtons onError={setError} divider="below" signupRole="parent" />
              {errorBox}
              <form onSubmit={submitParentAccount} className="flex flex-col gap-4 max-w-md">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="pa-first" className={labelClass}>First Name</label>
                    <input type="text" id="pa-first" value={form.firstName} onChange={set('firstName')} className={inputClass} required />
                  </div>
                  <div>
                    <label htmlFor="pa-last" className={labelClass}>Last Name</label>
                    <input type="text" id="pa-last" value={form.lastName} onChange={set('lastName')} className={inputClass} required />
                  </div>
                </div>
                <div>
                  <label htmlFor="pa-email" className={labelClass}>Email</label>
                  <input type="email" id="pa-email" value={form.email} onChange={set('email')} className={inputClass} required />
                </div>
                <div>
                  <label htmlFor="pa-password" className={labelClass}>Password</label>
                  <input type="password" id="pa-password" value={form.password} onChange={set('password')} className={inputClass} required minLength={6} />
                </div>
                <div>
                  <label htmlFor="pa-confirm" className={labelClass}>Confirm Password</label>
                  <input type="password" id="pa-confirm" value={form.confirmPassword} onChange={set('confirmPassword')} className={inputClass} required minLength={6} />
                </div>
                <button type="submit" disabled={submitting} className={primaryBtn}>
                  {submitting ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i> Creating Account...</>
                  ) : (
                    'Create Account'
                  )}
                </button>
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => setStep('dob')} className="inline-flex min-h-[44px] items-center text-xs text-brand-fg hover:underline active:underline">
                    Back
                  </button>
                  <p className="text-xs text-tertiary">
                    Already have an account?
                    <span className="text-brand-fg hover:underline cursor-pointer ml-1" onClick={onBackToLogin}>
                      Log in
                    </span>
                  </p>
                </div>
              </form>
            </>
          )}

          {step === 'parent-done' && (
            <div className="text-center py-8">
              <i className="fas fa-circle-check text-brand-fg text-4xl mb-4"></i>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">You&apos;re all set</h2>
              <p className="text-sm text-tertiary max-w-md mx-auto mb-6">
                Next step: add your athlete. Sign in and we&apos;ll walk you
                through setting up their profile — you stay in control of
                their privacy and what gets posted.
              </p>
              <button type="button" onClick={onBackToLogin} className={`${primaryBtn} max-w-xs mx-auto`}>
                Sign in to continue
              </button>
            </div>
          )}

          {step === 'details' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 space-micro">Create Athlete Account</h2>
              <OAuthButtons onError={setError} divider="below" />
              {errorBox}
              {success && (
                <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 px-4 py-3 rounded-md text-sm mb-4">
                  {success}
                </div>
              )}
              <form
                className="gap-micro flex flex-col"
                onSubmit={e => { e.preventDefault(); submitAccount(); }}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="rs-first" className={labelClass}>First Name</label>
                    <input type="text" id="rs-first" value={form.firstName} onChange={set('firstName')} className={inputClass} placeholder="Enter first name" required />
                  </div>
                  <div>
                    <label htmlFor="rs-last" className={labelClass}>Last Name</label>
                    <input type="text" id="rs-last" value={form.lastName} onChange={set('lastName')} className={inputClass} placeholder="Enter last name" required />
                  </div>
                </div>
                <HandleSelector
                  firstName={form.firstName}
                  lastName={form.lastName}
                  onCheckingChange={checking => { handleCheckingRef.current = checking; }}
                  onHandleSelected={h => {
                    setForm(f => ({ ...f, handle: h }));
                    if (h) {
                      // The green transition clears any stale wait banner and
                      // completes a submit that was parked on the check.
                      setError(prev =>
                        prev === HANDLE_CHECKING_MSG || prev === HANDLE_WAIT_MSG ? '' : prev
                      );
                      if (pendingSubmitRef.current) {
                        pendingSubmitRef.current = false;
                        submitAccount(undefined, h);
                      }
                    } else if (pendingSubmitRef.current) {
                      // Check settled taken/invalid — drop the parked submit;
                      // the selector shows its own message.
                      pendingSubmitRef.current = false;
                      setError(prev => (prev === HANDLE_CHECKING_MSG ? '' : prev));
                    }
                  }}
                  required
                />
                <div>
                  <label htmlFor="rs-nickname" className={labelClass}>Nickname</label>
                  <input type="text" id="rs-nickname" value={form.nickname} onChange={set('nickname')} className={inputClass} placeholder="Enter nickname" />
                </div>
                <div>
                  <label htmlFor="rs-email" className={labelClass}>Email</label>
                  <input type="email" id="rs-email" value={form.email} onChange={set('email')} className={inputClass} placeholder="Enter email" required />
                </div>
                <div>
                  <label htmlFor="rs-phone" className={labelClass}>Phone Number</label>
                  <input type="tel" id="rs-phone" value={form.phone} onChange={set('phone')} className={inputClass} placeholder="Enter phone number" />
                </div>
                <div>
                  <span className={labelClass}>Gender</span>
                  <div className="flex gap-4">
                    {(['female', 'male', 'custom'] as const).map(g => (
                      <label key={g} className="flex items-center gap-1 text-sm text-secondary capitalize">
                        <input
                          type="radio"
                          name="rs-gender"
                          checked={form.gender === g}
                          onChange={() => setForm(f => ({ ...f, gender: g }))}
                        />
                        {g}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="rs-location" className={labelClass}>Location</label>
                    <input type="text" id="rs-location" value={form.location} onChange={set('location')} className={inputClass} placeholder="Enter your location" />
                  </div>
                  <div>
                    <label htmlFor="rs-postal" className={labelClass}>Postal Code</label>
                    <input type="text" id="rs-postal" value={form.postalCode} onChange={set('postalCode')} className={inputClass} placeholder="Enter postal code" />
                  </div>
                </div>
                <div>
                  <label htmlFor="rs-password" className={labelClass}>Password</label>
                  <input type="password" id="rs-password" value={form.password} onChange={set('password')} className={inputClass} placeholder="Enter password" required minLength={6} />
                </div>
                <div>
                  <label htmlFor="rs-confirm" className={labelClass}>Confirm Password</label>
                  <input type="password" id="rs-confirm" value={form.confirmPassword} onChange={set('confirmPassword')} className={inputClass} placeholder="Confirm password" required minLength={6} />
                </div>
                {error && (
                  <p className="text-sm text-red-600 text-center" aria-hidden="true">{error}</p>
                )}
                <button type="submit" disabled={submitting} className={primaryBtn}>
                  {submitting ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i> Creating Account...</>
                  ) : (
                    <><i className="fas fa-user-plus mr-2"></i> Create Account</>
                  )}
                </button>
              </form>
              <div className="mt-4 flex items-center justify-between">
                <button type="button" onClick={() => setStep('dob')} className="inline-flex min-h-[44px] items-center text-xs text-brand-fg hover:underline active:underline">
                  Back
                </button>
                <p className="text-xs text-tertiary">
                  Already have an account?
                  <span className="text-brand-fg hover:underline cursor-pointer ml-1" onClick={onBackToLogin}>
                    Log in
                  </span>
                </p>
              </div>
            </>
          )}

          {step === 'guardian' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-1">One more step</h2>
              <p className="text-sm text-tertiary mb-4">
                A parent or guardian needs to finish setting up this account.
                Enter their email and we&apos;ll send them a link — they stay in
                control of the profile, and you&apos;ll be able to use it once
                they&apos;re done.
              </p>
              {errorBox}
              <form
                className="flex flex-col gap-4 max-w-sm"
                onSubmit={e => { e.preventDefault(); submitAccount(guardianEmail); }}
              >
                <div>
                  <label htmlFor="rs-guardian-email" className={labelClass}>Parent or guardian&apos;s email</label>
                  <input
                    type="email"
                    id="rs-guardian-email"
                    value={guardianEmail}
                    onChange={e => setGuardianEmail(e.target.value)}
                    className={inputClass}
                    placeholder="parent@example.com"
                    required
                  />
                </div>
                <button type="submit" disabled={submitting} className={primaryBtn}>
                  {submitting ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i> Sending...</>
                  ) : (
                    'Send the link'
                  )}
                </button>
              </form>
              <div className="mt-4">
                <p className="text-xs text-tertiary">
                  Already have an account?
                  <span className="text-brand-fg hover:underline cursor-pointer ml-1" onClick={onBackToLogin}>
                    Log in
                  </span>
                </p>
              </div>
            </>
          )}

          {step === 'parked' && (
            <div className="text-center py-8">
              <i className="fas fa-envelope-circle-check text-brand-fg text-4xl mb-4"></i>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">Check with your parent or guardian</h2>
              <p className="text-sm text-tertiary max-w-md mx-auto mb-6">
                {parkedMessage || "We've emailed your parent or guardian a link to finish setting up your profile."}
              </p>
              {/* The link is the reliable channel (owner decision) — this
                  screen is the minor's ONLY reachable surface. Since the
                  dummy-proofing round it survives refresh via localStorage
                  (7-day TTL, matching the invite), and only the explicit
                  back-to-login below clears it. */}
              {parkedInviteUrl && (
                <div className="mb-6">
                  <InviteLinkShare
                    url={parkedInviteUrl}
                    hint="Text or show this link to your parent or guardian — it's valid for 7 days and works once."
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  // EXPLICIT exit — the one action that forgets the parked
                  // link (an accidental refresh never does).
                  clearParkedInvite();
                  onBackToLogin();
                }}
                className="text-sm text-brand-fg hover:underline"
              >
                Back to login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
