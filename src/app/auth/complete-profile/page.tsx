'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import BrandBar from '@/components/BrandBar';
import HandleSelector from '@/components/HandleSelector';
import { deriveNamesFromMetadata } from '@/lib/oauth-profile';

// One-time stop for first-time OAuth users: their auth session exists but no
// profiles row does (profiles are route-created, and the handle must be set
// at creation time). Names arrive prefilled from provider metadata.
export default function CompleteProfilePage() {
  const { user, profile, loading, initialAuthCheckComplete, refreshProfile, signOut } = useAuth();
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [handle, setHandle] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [emailCollision, setEmailCollision] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  // Route guards: unauthenticated → login; already has a profile → onward.
  useEffect(() => {
    if (loading || !initialAuthCheckComplete) return;
    if (!user) {
      router.replace('/');
    } else if (profile) {
      router.replace(profile.onboarded_at ? '/athlete' : '/onboarding');
    }
  }, [user, profile, loading, initialAuthCheckComplete, router]);

  // Prefill names from OAuth metadata once the user is known.
  useEffect(() => {
    if (!user || prefilled) return;
    const { firstName: f, lastName: l } = deriveNamesFromMetadata(
      user.user_metadata,
      user.email
    );
    setFirstName(f);
    setLastName(l);
    setPrefilled(true);
  }, [user, prefilled]);

  // Same visibility treatment as the signup form: bring errors on-screen.
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      errorRef.current.focus({ preventScroll: true });
    }
  }, [error]);

  if (loading || !initialAuthCheckComplete || !user || profile) {
    return (
      <div className="min-h-screen bg-violet-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600 mx-auto"></div>
          <p className="mt-4 text-gray-700 font-medium">One moment...</p>
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
    if (!handle) {
      setError('Please wait for your handle to be confirmed as available, or pick another handle.');
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
          handle,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || 'Something went wrong. Please try again.');
        setEmailCollision(response.status === 409 && /email/i.test(result.error || ''));
        setSubmitting(false);
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

  return (
    <div className="min-h-screen flex flex-col bg-violet-50">
      <BrandBar />
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-lg shadow-lg p-6 sm:p-8">
          <h2 className="text-xl sm:text-2xl font-bold text-violet-800 mb-1">
            Complete your account
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            You&apos;re almost in — confirm your name and pick a handle.
          </p>

          {error && (
            <div
              ref={errorRef}
              role="alert"
              tabIndex={-1}
              className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm mb-4"
            >
              {error}
              {emailCollision && (
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="block mt-2 text-violet-600 hover:underline font-medium"
                >
                  Go to login
                </button>
              )}
            </div>
          )}

          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cp-first-name" className="block text-sm font-medium text-gray-700 mb-1">
                  First Name
                </label>
                <input
                  type="text"
                  id="cp-first-name"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  className="w-full px-4 py-3 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                  required
                />
              </div>
              <div>
                <label htmlFor="cp-last-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Last Name
                </label>
                <input
                  type="text"
                  id="cp-last-name"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  className="w-full px-4 py-3 text-sm text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={user.email ?? ''}
                disabled
                className="w-full px-4 py-3 text-sm text-gray-500 bg-gray-100 border border-gray-300 rounded-md cursor-not-allowed"
              />
            </div>

            <HandleSelector
              firstName={firstName}
              lastName={lastName}
              onHandleSelected={setHandle}
              required
            />

            {error && (
              <p className="text-sm text-red-600 text-center" aria-hidden="true">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-violet-600 text-white py-3 px-4 rounded-md hover:bg-violet-700 transition duration-300 flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
          </form>
        </div>
      </div>
    </div>
  );
}
