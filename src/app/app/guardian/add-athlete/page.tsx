'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import BrandBar from '@/components/BrandBar';
import HandleSelector from '@/components/HandleSelector';
import { FEATURE_FLAGS } from '@/lib/features';

// Step B: guardian creates a managed athlete profile. Repeatable (one per
// child — twins welcome; there is deliberately no name+DOB dedupe).
// DECISION: no email field — the child has no email; their profile links to
// the guardian purely via profile_access, and login credentials (username +
// password/PIN) are issued by the guardian in a later phase.
export default function AddAthletePage() {
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [handle, setHandle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createdName, setCreatedName] = useState('');
  const [createdId, setCreatedId] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);

  const [pendingProfileId, setPendingProfileId] = useState('');

  // Prefill from the guardian signup branch (held athlete DOB) and/or a
  // claimed athlete-initiated invite (name + DOB + pending row id).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const held = window.sessionStorage.getItem('ea:athlete-dob');
    if (held) setDob(held);
    try {
      const name = JSON.parse(window.sessionStorage.getItem('ea:athlete-name') || 'null');
      if (name?.first) setFirstName(name.first);
      if (name?.last) setLastName(name.last);
    } catch {}
    const pid = window.sessionStorage.getItem('ea:pending-profile-id');
    if (pid) setPendingProfileId(pid);
  }, []);

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      errorRef.current.focus({ preventScroll: true });
    }
  }, [error]);

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
    if (!firstName.trim()) { setError("Please enter your athlete's first name."); return; }
    if (!dob) { setError("Please enter your athlete's date of birth."); return; }
    if (!handle) {
      setError('Please wait for the handle to be confirmed as available, or pick another one.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/guardian/athletes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          dob,
          handle,
          ...(pendingProfileId ? { pendingProfileId } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || 'Something went wrong. Please try again.');
        return;
      }
      window.sessionStorage.removeItem('ea:athlete-dob');
      window.sessionStorage.removeItem('ea:athlete-name');
      window.sessionStorage.removeItem('ea:pending-profile-id');
      setPendingProfileId('');
      setCreatedName(firstName.trim());
      setCreatedId(result.profileId ?? '');
      setFirstName(''); setLastName(''); setDob(''); setHandle('');
    } catch (err) {
      console.error('Add athlete error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-surface rounded-lg shadow-lg p-6 sm:p-8">
          {createdName ? (
            <div className="text-center py-4">
              <i className="fas fa-circle-check text-brand-fg text-4xl mb-4"></i>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">
                {createdName}&apos;s profile is ready
              </h2>
              <p className="text-sm text-tertiary max-w-md mx-auto mb-6">
                It starts private — nothing is visible to anyone else until
                you approve it. You can switch into their profile from the
                menu at the top right.
              </p>
              <div className="flex flex-col gap-2 max-w-xs mx-auto">
                {createdId && (
                  <button
                    type="button"
                    onClick={() => router.push(`/app/guardian/consent/${createdId}`)}
                    className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition text-sm font-medium"
                  >
                    Complete consent now
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setCreatedName(''); setCreatedId(''); }}
                  className="w-full border border-brand text-brand-fg-strong py-3 px-4 rounded-md hover:bg-brand-soft transition text-sm font-medium"
                >
                  Add another athlete
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/athlete')}
                  className="text-sm text-brand-fg hover:underline py-2"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-1">Add your athlete</h2>
              <p className="text-sm text-tertiary mb-4">
                Their profile starts private, and you control what gets shared.
                No email needed — they&apos;ll never need one to use their profile.
              </p>
              {error && (
                <div
                  ref={errorRef}
                  role="alert"
                  tabIndex={-1}
                  className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4"
                >
                  {error}
                </div>
              )}
              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="aa-first" className="block text-sm font-medium text-secondary mb-1">First Name</label>
                    <input type="text" id="aa-first" value={firstName} onChange={e => setFirstName(e.target.value)}
                      className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500" required />
                  </div>
                  <div>
                    <label htmlFor="aa-last" className="block text-sm font-medium text-secondary mb-1">Last Name</label>
                    <input type="text" id="aa-last" value={lastName} onChange={e => setLastName(e.target.value)}
                      className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500" />
                  </div>
                </div>
                <div>
                  <label htmlFor="aa-dob" className="block text-sm font-medium text-secondary mb-1">Date of birth</label>
                  <input type="date" id="aa-dob" value={dob} onChange={e => setDob(e.target.value)}
                    className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500" required />
                </div>
                <HandleSelector
                  firstName={firstName}
                  lastName={lastName}
                  onHandleSelected={setHandle}
                  required
                />
                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400 text-center" aria-hidden="true">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition duration-300 flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i> Creating profile...</>
                  ) : (
                    <><i className="fas fa-user-plus mr-2"></i> Create their profile</>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
