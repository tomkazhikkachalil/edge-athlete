'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import BrandBar from '@/components/BrandBar';
import { FEATURE_FLAGS } from '@/lib/features';
import { CONSENT_STATEMENT } from '@/lib/consent';

// Guardian consent capture (Phase 3b): read the statement, sign it on paper,
// upload a photo/scan. The profile stays locked (private, unpublishable)
// until an admin review approves the submission.
export default function ConsentPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const profileId = params.profileId as string;

  const [state, setState] = useState<'loading' | 'none' | 'pending_review' | 'approved' | 'rejected' | 'forbidden'>('loading');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const res = await fetch(`/api/guardian/athletes/${profileId}/consent`);
      if (res.status === 403) { setState('forbidden'); return; }
      if (!res.ok) { setState('none'); return; }
      const data = await res.json();
      setState(data.state ?? 'none');
    })();
  }, [user, profileId]);

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user || state === 'loading') {
    return (
      <div className="min-h-screen bg-violet-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600"></div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Please attach the signed form.'); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('evidence', file);
      const res = await fetch(`/api/guardian/athletes/${profileId}/consent`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Upload failed. Please try again.'); return; }
      setState('pending_review');
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-violet-50">
      <BrandBar />
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg p-6 sm:p-8">
          {state === 'forbidden' && (
            <p className="text-sm text-gray-600 text-center py-8">
              Only this athlete&apos;s guardian can manage consent.
            </p>
          )}

          {(state === 'pending_review' || state === 'approved') && (
            <div className="text-center py-6">
              <i className={`fas ${state === 'approved' ? 'fa-circle-check' : 'fa-hourglass-half'} text-violet-600 text-4xl mb-4`}></i>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 mb-2">
                {state === 'approved' ? 'Consent approved' : 'Consent under review'}
              </h2>
              <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
                {state === 'approved'
                  ? "You're all set — you can now choose what to share from their profile."
                  : "We've received your signed form. We'll review it shortly — the profile stays private until then."}
              </p>
              <button type="button" onClick={() => router.push('/athlete')} className="text-sm text-violet-600 hover:underline">
                Back to my account
              </button>
            </div>
          )}

          {(state === 'none' || state === 'rejected') && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 mb-1">Parental consent</h2>
              <p className="text-sm text-gray-600 mb-4">
                {state === 'rejected'
                  ? 'Your previous submission couldn’t be verified — please re-submit a clear photo or scan of the signed statement.'
                  : 'One last step to activate your athlete’s profile: sign the statement below and upload a photo or scan of it.'}
              </p>
              <pre className="whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-md p-4 text-xs text-gray-700 mb-4 max-h-64 overflow-y-auto">
                {CONSENT_STATEMENT}
              </pre>
              {error && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm mb-4">
                  {error}
                </div>
              )}
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label htmlFor="consent-file" className="block text-sm font-medium text-gray-700 mb-1">
                    Signed form (photo or PDF, 10 MB max)
                  </label>
                  <input
                    type="file"
                    id="consent-file"
                    ref={fileRef}
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-violet-600 file:text-white hover:file:bg-violet-700"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-violet-600 text-white py-3 px-4 rounded-md hover:bg-violet-700 transition duration-300 flex items-center justify-center text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i> Uploading...</>
                  ) : (
                    'Submit signed consent'
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
