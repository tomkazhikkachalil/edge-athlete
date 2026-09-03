'use client';

import { useState, useEffect, useRef } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import BrandBar from '@/components/BrandBar';
import { supabase } from '@/lib/supabase';
import { safeInternalPath } from '@/lib/safe-internal-path';
import WaitlistPopup from '@/components/WaitlistPopup';
import HandleSelector from '@/components/HandleSelector';
import OAuthButtons from '@/components/OAuthButtons';
import RegistrationSteps from '@/components/signup/RegistrationSteps';
import LogoDevAttribution from '@/components/LogoDevAttribution';
import { FEATURE_FLAGS } from '@/lib/features';

export default function Home() {
  const [showAthleteRegistration, setShowAthleteRegistration] = useState(false);
  const [orgIntent, setOrgIntent] = useState<'club' | 'league' | null>(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    nickname: '',
    email: '',
    phone: '',
    birthday: '',
    gender: '',
    location: '',
    postalCode: '',
    password: '',
    confirmPassword: '',
    handle: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [resendingConfirmation, setResendingConfirmation] = useState(false);
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [waitlistUserType, setWaitlistUserType] = useState('');

  const { signIn, user, profile, loading, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const errorRef = useRef<HTMLDivElement>(null);

  // The error banner sits at the top of a tall form — on phones a failed
  // submit was invisible (looked like the button did nothing). Bring it
  // on-screen and announce it.
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      errorRef.current.focus({ preventScroll: true });
    }
  }, [error]);

  // Redirect once logged in: brand-new users (no onboarded_at) get the
  // first-run onboarding; everyone else goes to their profile. A session
  // WITHOUT a profile row is a first-time OAuth user who hasn't finished
  // account setup (deleted-account stale sessions never reach here — auth.tsx
  // signs those out before initialAuthCheckComplete flips).
  useEffect(() => {
    if (loading || !initialAuthCheckComplete) return;
    if (user && profile) {
      // Return path (?next= or the invite page's sessionStorage fallback):
      // an invite claim must survive the sign-in round trip. Sanitized —
      // internal absolute paths only, never an open redirect.
      const params = new URLSearchParams(window.location.search);
      let returnPath = safeInternalPath(params.get('next'));
      if (!returnPath) {
        try {
          returnPath = safeInternalPath(window.sessionStorage.getItem('ea:invite-return'));
        } catch { /* storage unavailable */ }
      }
      if (returnPath) {
        try { window.sessionStorage.removeItem('ea:invite-return'); } catch { /* ignore */ }
        router.push(returnPath);
        return;
      }
      // Parents (097) live in the family console, never the athlete
      // wizard/profile — their first run goes straight to add-athlete
      // (prefilled from the DOB the signup flow stored).
      if (profile.user_type === 'parent') {
        router.push(profile.onboarded_at ? '/app/guardian' : '/app/guardian/add-athlete');
      } else {
        router.push(profile.onboarded_at ? '/athlete' : '/onboarding');
      }
    } else if (user && !profile) {
      router.push('/auth/complete-profile');
    }
  }, [user, profile, loading, initialAuthCheckComplete, router]);

  // Surface OAuth callback errors (?error=...) in the login error box.
  // window.location instead of useSearchParams — avoids the Suspense
  // boundary requirement. Effect-owned deliberately: reads window.location
  // and scrubs it with replaceState.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    if (oauthError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(oauthError);
      window.history.replaceState(null, '', '/');
    }
  }, []);

  // Show loading state while auth is being determined - prevent flash of login page
  if (loading || !initialAuthCheckComplete) {
    return (
      <div className="min-h-screen bg-brand-soft flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
          <p className="mt-4 text-secondary font-medium">Checking your session...</p>
          <p className="mt-1 text-sm text-muted">This should only take a moment</p>
        </div>
      </div>
    );
  }

  // If user is authenticated, show loading until redirect happens. Covers
  // user-without-profile too (redirects to /auth/complete-profile) —
  // deleted-account stale sessions are signed out by auth.tsx before
  // initialAuthCheckComplete, so they arrive here with user === null.
  if (user) {
    return (
      <div className="min-h-screen bg-brand-soft flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
          <p className="mt-4 text-secondary font-medium">Welcome back!</p>
          <p className="mt-1 text-sm text-muted">Redirecting to your profile...</p>
        </div>
      </div>
    );
  }

  const handleAthleteClick = () => {
    setShowAthleteRegistration(true);
    setError('');
    setSuccess('');
  };

  const handleWaitlistClick = (userType: string) => {
    setWaitlistUserType(userType);
    setShowWaitlist(true);
  };

  // Phase 7 C1: the Club / League doors. The account comes first (an org
  // is owned by a normal profile — mig 116), then the wizard. The intent
  // rides sessionStorage, the one channel that survives the registration
  // hard-reload in BOTH flag states: `/` honours `ea:invite-return` after
  // sign-in (the invite-claim precedent above).
  const handleOrgClick = (kind: 'club' | 'league') => {
    try {
      window.sessionStorage.setItem('ea:invite-return', `/${kind}/start?sport=golf`);
    } catch { /* storage unavailable — the start page's own CTA still parks it */ }
    setOrgIntent(kind);
    handleAthleteClick();
  };

  const handleCloseWaitlist = () => {
    setShowWaitlist(false);
    setWaitlistUserType('');
  };

  const handleBackToLogin = () => {
    setShowAthleteRegistration(false);
    setError('');
    setSuccess('');
    setFormData({
      firstName: '',
      lastName: '',
      nickname: '',
      email: '',
      phone: '',
      birthday: '',
      gender: '',
      location: '',
      postalCode: '',
      password: '',
      confirmPassword: '',
      handle: '',
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value, name } = e.target;
    const fieldName = id || name;
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  const handleRegistrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    setSuccess('');

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      setIsSubmitting(false);
      return;
    }

    // The handle only lands in formData once HandleSelector confirms
    // availability — an unconfirmed handle used to abort here with no
    // visible feedback.
    if (!formData.handle) {
      setError('Please wait for your handle to be confirmed as available, or pick another handle.');
      setIsSubmitting(false);
      return;
    }

    // Validate required fields
    if (!formData.email || !formData.password || !formData.firstName || !formData.lastName) {
      setError('Please fill in all required fields');
      setIsSubmitting(false);
      return;
    }

    try {
      
      // Use our custom API route for signup
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          profileData: {
            first_name: formData.firstName,
            last_name: formData.lastName,
            nickname: formData.nickname,
            phone: formData.phone,
            birthday: formData.birthday,
            gender: formData.gender as 'male' | 'female' | 'custom',
            location: formData.location,
            postal_code: formData.postalCode,
            user_type: 'athlete',
            handle: formData.handle,
          }
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'An error occurred during registration');
      } else {
        setSuccess('Account created successfully! Please sign in to continue.');
        // Reset form
        setFormData({
          firstName: '',
          lastName: '',
          nickname: '',
          email: '',
          phone: '',
          birthday: '',
          gender: '',
          location: '',
          postalCode: '',
          password: '',
          confirmPassword: '',
          handle: '',
        });
        // Switch back to login view after successful registration
        setTimeout(() => {
          setShowAthleteRegistration(false);
          // Optionally redirect to login or let them sign in
        }, 2000);
      }
    } catch (err: unknown) {
      console.error('Registration error:', err);
      Sentry.captureException(err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    const formDataObj = new FormData(e.target as HTMLFormElement);
    const email = formDataObj.get('email') as string;
    const password = formDataObj.get('password') as string;

    try {
      // Supervised-minor login: an identifier without '@' is a username
      // (their handle). The server hard-rejects non-supervised accounts, so
      // this can never become a general login path.
      if (FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES && email && !email.includes('@')) {
        const res = await fetch('/api/auth/username-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: email, secret: password }),
        });
        if (res.ok) {
          // Cookies were set server-side — hard reload picks up the session.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- cookies were set server-side; a hard reload is how the session is picked up
          window.location.href = '/athlete';
          return;
        }
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Invalid username or password');
        setIsSubmitting(false);
        return;
      }

      const { error } = await signIn(email, password);
      
      if (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid email or password';
        // Supabase returns "Email not confirmed" when confirmation is enabled
        // and the user hasn't clicked their verification link — without this
        // branch they'd be stuck at "invalid credentials" with no way out.
        if (/email not confirmed/i.test(errorMessage)) {
          setUnconfirmedEmail(email);
          setError('Your email address has not been confirmed yet. Check your inbox for the confirmation link, or resend it below.');
        } else {
          setUnconfirmedEmail(null);
          setError(errorMessage);
        }
      } else {
        setSuccess('Login successful! Redirecting to your profile...');
        // The redirect will happen automatically via useEffect when user state changes
      }
    } catch (err) {
      setError('An unexpected error occurred');
      console.error('Login error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!unconfirmedEmail || resendingConfirmation) return;
    setResendingConfirmation(true);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: unconfirmedEmail,
      });
      if (resendError) {
        setError(resendError.message || 'Failed to resend confirmation email.');
      } else {
        setError('');
        setSuccess(`Confirmation email resent to ${unconfirmedEmail}. Check your inbox.`);
        setUnconfirmedEmail(null);
      }
    } catch {
      setError('Failed to resend confirmation email.');
    } finally {
      setResendingConfirmation(false);
    }
  };

  if (showAthleteRegistration) {
    // Guardian-profiles flow: DOB-first step machine (compliance-ordered).
    // The legacy single-form registration below remains the flag-off path.
    if (FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return (
        <div className="min-h-screen flex flex-col bg-brand-soft">
          <BrandBar />
          <RegistrationSteps onBackToLogin={handleBackToLogin} initialOrg={orgIntent} />
        </div>
      );
    }
    return (
      <div className="min-h-screen flex flex-col bg-brand-soft">
        <BrandBar />

        <div className="flex-grow flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-surface rounded-lg shadow-lg overflow-hidden">
            <div className="w-full p-6 sm:p-8">
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 space-micro">Create Athlete Account</h2>
              <OAuthButtons onError={setError} divider="below" />
              {error && (
                <div
                  ref={errorRef}
                  role="alert"
                  tabIndex={-1}
                  className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm"
                >
                  {error}
                </div>
              )}
              {success && (
                <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 px-4 py-3 rounded-md text-sm">
                  {success}
                </div>
              )}
              <form className="gap-micro flex flex-col" onSubmit={handleRegistrationSubmit}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="first-name" className="block text-sm font-medium text-secondary mb-1">First Name</label>
                    <input
                      type="text"
                      id="firstName"
                      value={formData.firstName}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                      placeholder="Enter first name"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="lastName" className="block text-sm font-medium text-secondary mb-1">Last Name</label>
                    <input
                      type="text"
                      id="lastName"
                      value={formData.lastName}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                      placeholder="Enter last name"
                      required
                    />
                  </div>
                </div>
                <HandleSelector
                  firstName={formData.firstName}
                  lastName={formData.lastName}
                  onHandleSelected={(handle) => setFormData(prev => ({ ...prev, handle }))}
                  required={true}
                />
                <div>
                  <label htmlFor="nickname" className="block text-sm font-medium text-secondary mb-1">Nickname</label>
                  <input
                    type="text"
                    id="nickname"
                    value={formData.nickname}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                    placeholder="Enter nickname"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-secondary mb-1">Email</label>
                  <input
                    type="email"
                    id="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                    placeholder="Enter email"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-secondary mb-1">Phone Number</label>
                  <input
                    type="tel"
                    id="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                    placeholder="Enter phone number"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="birthday" className="block text-sm font-medium text-secondary mb-1">Birthday</label>
                    <input
                      type="date"
                      id="birthday"
                      value={formData.birthday}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-secondary mb-1">Gender</label>
                    <div className="flex flex-wrap gap-3 sm:space-x-4 sm:gap-0">
                      <label className="inline-flex items-center">
                        <input 
                          type="radio" 
                          name="gender" 
                          value="female" 
                          checked={formData.gender === 'female'}
                          onChange={handleInputChange}
                          className="form-radio text-brand-fg" 
                        />
                        <span className="ml-1 text-sm">Female</span>
                      </label>
                      <label className="inline-flex items-center">
                        <input 
                          type="radio" 
                          name="gender" 
                          value="male" 
                          checked={formData.gender === 'male'}
                          onChange={handleInputChange}
                          className="form-radio text-brand-fg" 
                        />
                        <span className="ml-1 text-sm">Male</span>
                      </label>
                      <label className="inline-flex items-center">
                        <input 
                          type="radio" 
                          name="gender" 
                          value="custom" 
                          checked={formData.gender === 'custom'}
                          onChange={handleInputChange}
                          className="form-radio text-brand-fg" 
                        />
                        <span className="ml-1 text-sm">Custom</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div>
                  <label htmlFor="location" className="block text-sm font-medium text-secondary mb-1">Location</label>
                  <div className="relative">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <input
                          type="text"
                          id="location"
                          value={formData.location}
                          onChange={handleInputChange}
                          className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                          placeholder="Enter your location"
                        />
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          id="postalCode"
                          value={formData.postalCode}
                          onChange={handleInputChange}
                          className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500 pr-10"
                          placeholder="Enter postal code"
                        />
                        <button type="button" className="absolute right-2 top-1/2 transform -translate-y-1/2 text-faint hover:text-violet-500 sm:hidden">
                          <i className="fas fa-location-dot text-sm"></i>
                        </button>
                      </div>
                    </div>
                    <button type="button" className="hidden sm:block absolute right-2 top-1/2 transform -translate-y-1/2 text-faint hover:text-violet-500">
                      <i className="fas fa-location-dot"></i>
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-secondary mb-1">Password</label>
                  <input
                    type="password"
                    id="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                    placeholder="Enter password"
                    required
                    minLength={6}
                  />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-secondary mb-1">Confirm Password</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                    placeholder="Confirm password"
                    required
                    minLength={6}
                  />
                </div>
                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400 text-center" aria-hidden="true">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition duration-300 flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <i className="fas fa-spinner fa-spin mr-2"></i> Creating Account...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-user-plus mr-2"></i> Create Account
                    </>
                  )}
                </button>
              </form>
              <div className="mt-4 text-center">
                <p className="text-xs text-tertiary">
                  Already have an account? 
                  <span 
                    className="text-brand-fg hover:underline cursor-pointer ml-1"
                    onClick={handleBackToLogin}
                  >
                    Log in as an Athlete
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />
      
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-4xl flex flex-col lg:flex-row bg-surface rounded-lg shadow-lg overflow-hidden">
          {/* Login Section */}
          <div className="w-full lg:w-1/2 p-6 sm:p-8 lg:p-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-violet-800 dark:text-violet-200 mb-6 sm:mb-8 text-center lg:text-left">Login to Your Account</h2>
            {error && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4">
                {error}
                {unconfirmedEmail && (
                  <button
                    type="button"
                    onClick={handleResendConfirmation}
                    disabled={resendingConfirmation}
                    className="block mt-2 font-semibold text-brand-fg hover:text-brand-fg-strong disabled:opacity-50"
                  >
                    {resendingConfirmation ? 'Resending…' : 'Resend confirmation email'}
                  </button>
                )}
              </div>
            )}
            {success && (
              <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 px-4 py-3 rounded-md text-sm mb-4">
                {success}
              </div>
            )}
            <form className="space-y-4" onSubmit={handleLoginSubmit}>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-secondary mb-2">
                  {FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES ? 'Email or username' : 'Email'}
                </label>
                <input
                  type={FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES ? 'text' : 'email'}
                  name="email"
                  autoComplete="username"
                  className="w-full px-3 py-3 sm:py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 text-base text-primary"
                  placeholder={FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES ? 'Enter your email or username' : 'Enter your email'}
                  required
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-secondary mb-2">Password</label>
                <input 
                  type="password" 
                  name="password"
                  className="w-full px-3 py-3 sm:py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 text-base text-primary" 
                  placeholder="Enter your password"
                  required
                />
                <div className="mt-2 text-right">
                  <Link href="/forgot-password" className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
                    Forgot password?
                  </Link>
                </div>
              </div>
              <button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition duration-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i> Logging in...
                  </>
                ) : (
                  'Login'
                )}
              </button>
            </form>
            <OAuthButtons onError={setError} />
          </div>

          {/* Sign Up Section */}
          <div className="w-full lg:w-1/2 bg-brand p-6 sm:p-8 lg:p-12 text-white flex flex-col justify-between">
            <div className="flex flex-col items-center justify-center flex-grow">
              <h2 className="text-2xl sm:text-3xl font-bold mb-4 text-center">New Here?</h2>
              <p className="mb-6 text-center text-sm sm:text-base">Choose your role and sign up to discover new opportunities!</p>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 w-full max-w-sm">
                <button 
                  className="bg-white text-violet-600 py-3 px-3 sm:px-4 rounded-md font-semibold hover:bg-violet-100 transition duration-300 flex flex-col sm:flex-row items-center justify-center text-xs sm:text-sm"
                  onClick={handleAthleteClick}
                >
                  <i className="fas fa-person-running mb-1 sm:mb-0 sm:mr-2 text-lg sm:text-base"></i>
                  <span>Athlete</span>
                </button>
                <button 
                  onClick={() => handleOrgClick('club')}
                  className="bg-white text-violet-600 py-3 px-3 sm:px-4 rounded-md font-semibold hover:bg-violet-100 transition duration-300 flex flex-col sm:flex-row items-center justify-center text-xs sm:text-sm"
                >
                  <i className="fas fa-shield mb-1 sm:mb-0 sm:mr-2 text-lg sm:text-base"></i>
                  <span>Club</span>
                </button>
                <button 
                  onClick={() => handleOrgClick('league')}
                  className="bg-white text-violet-600 py-3 px-3 sm:px-4 rounded-md font-semibold hover:bg-violet-100 transition duration-300 flex flex-col sm:flex-row items-center justify-center text-xs sm:text-sm"
                >
                  <i className="fas fa-trophy mb-1 sm:mb-0 sm:mr-2 text-lg sm:text-base"></i>
                  <span>League</span>
                </button>
                <button 
                  onClick={() => handleWaitlistClick('Fan')}
                  className="bg-white text-violet-600 py-3 px-3 sm:px-4 rounded-md font-semibold hover:bg-violet-100 transition duration-300 flex flex-col sm:flex-row items-center justify-center text-xs sm:text-sm"
                >
                  <i className="fas fa-star mb-1 sm:mb-0 sm:mr-2 text-lg sm:text-base"></i>
                  <span>Fan</span>
                </button>
              </div>
            </div>
            <div className="mt-6 sm:mt-8">
              <button 
                onClick={() => router.push('/explore')}
                className="w-full bg-transparent border-2 border-white text-white py-3 px-4 rounded-md font-semibold hover:bg-surface hover:text-brand-fg transition duration-300 flex items-center justify-center text-sm sm:text-base"
              >
                <i className="fas fa-binoculars mr-2"></i> Explore as Guest
              </button>
              {/* Phase 9 V6: the public club directory — a real page, no account. */}
              <Link
                href="/clubs"
                className="mt-3 block text-center text-sm text-white/90 underline underline-offset-2 hover:text-white"
              >
                Find a golf club near you
              </Link>
            </div>
          </div>
        </div>
      </div>
      
      <footer className="py-2 px-4">
        {/* min-h grows the ~16px text rows to real touch targets without
            changing the visual size — the drawer-footer idiom (AppHeader). */}
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0 text-xs text-muted">
          <Link href="/terms" className="inline-flex min-h-[44px] items-center px-2 hover:text-secondary active:text-secondary">Terms</Link>
          <Link href="/privacy" className="inline-flex min-h-[44px] items-center px-2 hover:text-secondary active:text-secondary">Privacy</Link>
          <Link href="/contact" className="inline-flex min-h-[44px] items-center px-2 hover:text-secondary active:text-secondary">Contact</Link>
          {/* Logo.dev's free plan requires a PUBLICLY reachable credit; the
              equipment picker that shows their logos is behind login, so the
              verifiable copy lives here. Renders nothing without a token. */}
          <LogoDevAttribution className="inline-flex min-h-[44px] items-center px-2" />
          <span>&copy; {new Date().getFullYear()} Edge Athlete</span>
        </div>
      </footer>

      {/* Waitlist Popup */}
      <WaitlistPopup
        isOpen={showWaitlist}
        onClose={handleCloseWaitlist}
        userType={waitlistUserType}
      />
    </div>
  );
}