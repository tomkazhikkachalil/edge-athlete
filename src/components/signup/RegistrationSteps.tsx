'use client';

import { useState, useEffect, useRef } from 'react';
import * as Sentry from '@sentry/nextjs';
import HandleSelector from '@/components/HandleSelector';
import OAuthButtons from '@/components/OAuthButtons';
import { isValidDateString, isNotFutureDate } from '@/lib/date-validation';

// DOB-first registration step machine (guardian-profiles feature).
//
// Step order is a compliance requirement, not a style choice:
//   1. 'dob'      — date of birth alone, NEUTRAL wording. Never state or
//                   hint at any age threshold before collecting it.
//   2. 'role'     — "Who's setting this up?" (athlete / parent-guardian)
//   3. 'details'  — the account form (no birthday field — already collected)
//   4. 'guardian' — only reached when the server answers 422 needsGuardian
//                   (under-threshold): collect a guardian email. No dead end.
//   5. 'parked'   — confirmation that the guardian was emailed.
//
// The server (/api/signup) is authoritative for the age decision — this UI
// never computes the threshold locally, so it can't leak it either.

type Step = 'dob' | 'role' | 'details' | 'guardian' | 'parked';
type Role = 'athlete' | 'parent';

const inputClass =
  'w-full px-4 py-3 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';
const primaryBtn =
  'w-full bg-violet-600 text-white py-3 px-4 rounded-md hover:bg-violet-700 transition duration-300 flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';

export default function RegistrationSteps({ onBackToLogin }: { onBackToLogin: () => void }) {
  const [step, setStep] = useState<Step>('dob');
  const [role, setRole] = useState<Role>('athlete');
  const [dob, setDob] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [parkedMessage, setParkedMessage] = useState('');
  const [form, setForm] = useState({
    firstName: '', lastName: '', nickname: '', email: '', phone: '',
    gender: '', location: '', postalCode: '', password: '', confirmPassword: '',
    handle: '',
  });
  const [error, setError] = useState('');
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
    setStep('role');
  };

  const submitAccount = async (withGuardianEmail?: string) => {
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!form.handle) {
      setError('Please wait for your handle to be confirmed as available, or pick another handle.');
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
            handle: form.handle,
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
        setStep('parked');
        return;
      }
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
      className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm mb-4"
    >
      {error}
    </div>
  );

  return (
    <div className="flex-grow flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="w-full p-6 sm:p-8">
          {step === 'dob' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 mb-1">Let&apos;s get started</h2>
              <p className="text-sm text-gray-600 mb-4">First, we need a couple of details.</p>
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
                <button type="button" onClick={onBackToLogin} className="text-xs text-violet-600 hover:underline">
                  Back to login
                </button>
              </form>
            </>
          )}

          {step === 'role' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 mb-1">Who&apos;s setting this up?</h2>
              <p className="text-sm text-gray-600 mb-4">This helps us set up the right kind of account.</p>
              {errorBox}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
                <button
                  type="button"
                  onClick={() => { setRole('athlete'); setStep('details'); }}
                  className="border-2 border-violet-200 hover:border-violet-600 rounded-lg p-6 text-left transition"
                >
                  <i className="fas fa-person-running text-violet-600 text-2xl mb-2"></i>
                  <p className="font-bold text-gray-900">I&apos;m the athlete</p>
                  <p className="text-sm text-gray-600 mt-1">This account is for me.</p>
                </button>
                <button
                  type="button"
                  onClick={() => { setRole('parent'); setStep('details'); }}
                  className="border-2 border-violet-200 hover:border-violet-600 rounded-lg p-6 text-left transition"
                >
                  <i className="fas fa-user-shield text-violet-600 text-2xl mb-2"></i>
                  <p className="font-bold text-gray-900">I&apos;m a parent or guardian</p>
                  <p className="text-sm text-gray-600 mt-1">I&apos;m setting this up for my athlete.</p>
                </button>
              </div>
              <button type="button" onClick={() => setStep('dob')} className="mt-4 text-xs text-violet-600 hover:underline">
                Back
              </button>
            </>
          )}

          {step === 'details' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 space-micro">
                {role === 'parent' ? 'Create Your Account' : 'Create Athlete Account'}
              </h2>
              {role === 'parent' && (
                <p className="text-sm text-gray-600 mb-2">
                  Your own account comes first — you&apos;ll add your athlete right after.
                </p>
              )}
              <OAuthButtons onError={setError} divider="below" />
              {errorBox}
              {success && (
                <div className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md text-sm mb-4">
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
                  onHandleSelected={h => setForm(f => ({ ...f, handle: h }))}
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
                      <label key={g} className="flex items-center gap-1 text-sm text-gray-700 capitalize">
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
                <button type="button" onClick={() => setStep('role')} className="text-xs text-violet-600 hover:underline">
                  Back
                </button>
                <p className="text-xs text-gray-600">
                  Already have an account?
                  <span className="text-violet-600 hover:underline cursor-pointer ml-1" onClick={onBackToLogin}>
                    Log in
                  </span>
                </p>
              </div>
            </>
          )}

          {step === 'guardian' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 mb-1">One more step</h2>
              <p className="text-sm text-gray-600 mb-4">
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
            </>
          )}

          {step === 'parked' && (
            <div className="text-center py-8">
              <i className="fas fa-envelope-circle-check text-violet-600 text-4xl mb-4"></i>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 mb-2">Check with your parent or guardian</h2>
              <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
                {parkedMessage || "We've emailed your parent or guardian a link to finish setting up your profile."}
              </p>
              <button type="button" onClick={onBackToLogin} className="text-sm text-violet-600 hover:underline">
                Back to login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
