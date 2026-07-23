'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import LazyImage from '@/components/LazyImage';
import ConnectionSuggestions from '@/components/ConnectionSuggestions';
import { getInitials, formatDisplayName } from '@/lib/formatters';

// First-run onboarding: three SKIPPABLE steps (photo → find golfers → first
// round). Completing OR skipping stamps profiles.onboarded_at so the wizard
// never reappears. Deliberately not a gauntlet — every screen has a skip.
type Step = 1 | 2 | 3;

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export default function OnboardingPage() {
  const router = useRouter();
  const { user, profile, loading, refreshProfile } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [user, loading, router]);

  // Already onboarded? Straight to the app (guards direct URL visits).
  // NOT while finishing — markOnboarded's refresh would otherwise let this
  // effect override finish()'s chosen destination with /athlete.
  useEffect(() => {
    if (profile?.onboarded_at && !finishing) router.push('/athlete');
  }, [profile?.onboarded_at, finishing, router]);

  const displayName = formatDisplayName(
    profile?.first_name, null, profile?.last_name, profile?.full_name
  );

  const markOnboarded = async () => {
    try {
      await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileData: { onboarded_at: new Date().toISOString() } }),
      });
      await refreshProfile();
    } catch (e) {
      // Non-fatal: they'll see onboarding again next login, which is fine
      console.error('Failed to mark onboarding complete:', e);
    }
  };

  const finish = async (destination: string) => {
    if (finishing) return;
    setFinishing(true);
    await markOnboarded();
    router.push(destination);
  };

  const handleAvatarSelect = async (file: File | undefined) => {
    if (!file) return;
    setAvatarError(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setAvatarError('Please choose a JPG, PNG, GIF, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be under 5MB.');
      return;
    }

    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const response = await fetch('/api/upload/avatar', { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok) {
        setAvatarError(result.error || 'Upload failed. You can add a photo later from your profile.');
        return;
      }
      await refreshProfile();
      setStep(2);
    } catch (e) {
      console.error('Avatar upload failed:', e);
      setAvatarError('Upload failed. You can add a photo later from your profile.');
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-blue-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-blue-50 flex flex-col">
      <div className="w-full bg-blue-600 py-3 px-4">
        <h1 className="text-2xl font-bold text-white text-center">Edge Athlete</h1>
      </div>

      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-lg shadow-lg p-6 sm:p-8">
          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2 mb-6" aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map(s => (
              <span
                key={s}
                className={`h-2 rounded-full transition-all ${
                  s === step ? 'w-8 bg-blue-600' : s < step ? 'w-2 bg-blue-300' : 'w-2 bg-gray-200'
                }`}
              />
            ))}
          </div>

          {step === 1 && (
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Welcome{displayName ? `, ${displayName.split(' ')[0]}` : ''}! ⛳
              </h2>
              <p className="text-sm text-gray-600 mb-6">
                Add a profile photo so other golfers recognize you.
              </p>

              <div className="flex justify-center mb-6">
                {profile?.avatar_url ? (
                  <LazyImage
                    src={profile.avatar_url}
                    alt="Your profile photo"
                    className="w-28 h-28 rounded-full object-cover border-4 border-blue-100"
                    width={112}
                    height={112}
                  />
                ) : (
                  <div className="w-28 h-28 rounded-full bg-blue-500 flex items-center justify-center text-white text-3xl font-bold border-4 border-blue-100">
                    {getInitials(displayName) || '?'}
                  </div>
                )}
              </div>

              {avatarError && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-md text-sm mb-4">
                  {avatarError}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={e => handleAvatarSelect(e.target.files?.[0])}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 transition font-medium disabled:opacity-50 mb-3"
              >
                {avatarUploading ? (
                  <><i className="fas fa-spinner fa-spin mr-2"></i>Uploading…</>
                ) : profile?.avatar_url ? (
                  'Change photo'
                ) : (
                  'Choose a photo'
                )}
              </button>
              <div className="flex items-center justify-center gap-4">
                {profile?.avatar_url && (
                  <button
                    onClick={() => setStep(2)}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 min-h-[44px]"
                  >
                    Looks good — continue
                  </button>
                )}
                <button
                  onClick={() => setStep(2)}
                  className="text-sm text-gray-500 hover:text-gray-700 min-h-[44px]"
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">Find golfers to follow</h2>
              <p className="text-sm text-gray-600 mb-4 text-center">
                Your feed comes alive when you follow a few people.
              </p>

              <div className="mb-6">
                <ConnectionSuggestions profileId={user.id} limit={5} compact />
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="text-sm text-gray-500 hover:text-gray-700 min-h-[44px]"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="bg-blue-600 text-white py-2.5 px-6 rounded-md hover:bg-blue-700 transition font-medium min-h-[44px]"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center">
              <div className="text-5xl mb-4">🏌️</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re all set!</h2>
              <p className="text-sm text-gray-600 mb-6">
                The best way to start: log your most recent round. Your scores, stats, and
                trends build from there.
              </p>

              <button
                onClick={() => finish('/feed?create=1')}
                disabled={finishing}
                className="w-full bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700 transition font-semibold disabled:opacity-50 mb-3"
              >
                {finishing ? (
                  <><i className="fas fa-spinner fa-spin mr-2"></i>One sec…</>
                ) : (
                  <><i className="fas fa-golf-ball mr-2"></i>Log your first round</>
                )}
              </button>
              <button
                onClick={() => finish('/feed')}
                disabled={finishing}
                className="w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-md hover:bg-gray-200 transition font-medium disabled:opacity-50"
              >
                Take me to my feed
              </button>

              <button
                onClick={() => setStep(2)}
                className="mt-4 text-sm text-gray-500 hover:text-gray-700 min-h-[44px]"
              >
                ← Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
