'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import BrandBar from '@/components/BrandBar';
import LazyImage from '@/components/LazyImage';
import AvatarUploader from '@/components/AvatarUploader';
import ConnectionSuggestions from '@/components/ConnectionSuggestions';
import SportMultiSelect from '@/components/SportMultiSelect';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import { getInitials, formatDisplayName } from '@/lib/formatters';

// First-run onboarding: four SKIPPABLE steps (sports → photo → follow →
// first post). Completing OR skipping stamps profiles.onboarded_at so the
// wizard never reappears. Deliberately not a gauntlet — every screen has a
// skip. Sport-neutral by design: golf gets golf copy only AFTER the athlete
// picks golf; a skipped sport step keeps everything generic.
type Step = 1 | 2 | 3 | 4;


export default function OnboardingPage() {
  const router = useRouter();
  const { user, profile, loading, refreshProfile, signOut } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [selectedSports, setSelectedSports] = useState<SportKey[]>([]);
  const [savingSports, setSavingSports] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const primarySport = selectedSports[0] ?? null;
  const primaryDef = primarySport ? getSportDefinition(primarySport) : null;

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

  // Persist the sport choice the moment the athlete continues past step 1 —
  // it must survive bailing out of later steps. Primary sport → profiles.sport
  // (registry display name: ~12 UI sites and the explore filter render/match
  // the raw string), every selection → an empty sport_settings row (how
  // active-sports learns declared sports). Best-effort like markOnboarded.
  const saveSports = async () => {
    if (selectedSports.length === 0) {
      setStep(2);
      return;
    }
    setSavingSports(true);
    try {
      await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileData: { sport: getSportDefinition(selectedSports[0]).display_name },
        }),
      });
      await Promise.all(
        selectedSports.map(key =>
          fetch('/api/sport-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sport: key, settings: {} }),
          })
        )
      );
      await refreshProfile();
    } catch (e) {
      // Non-fatal — the athlete can set sports later in Edit Profile
      console.error('Failed to save sport selection:', e);
    } finally {
      setSavingSports(false);
      setStep(2);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-violet-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-violet-50 flex flex-col">
      <BrandBar />

      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-lg shadow-lg p-6 sm:p-8">
          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2 mb-6" aria-label={`Step ${step} of 4`}>
            {[1, 2, 3, 4].map(s => (
              <span
                key={s}
                className={`h-2 rounded-full transition-all ${
                  s === step ? 'w-8 bg-violet-600' : s < step ? 'w-2 bg-violet-300' : 'w-2 bg-gray-200'
                }`}
              />
            ))}
          </div>

          {step === 1 && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
                Welcome{displayName ? `, ${displayName.split(' ')[0]}` : ''}!
              </h2>
              <p className="text-sm text-gray-600 mb-6 text-center">
                What do you play? This shapes your profile and feed.
              </p>

              <div className="mb-6">
                <SportMultiSelect selected={selectedSports} onChange={setSelectedSports} />
              </div>

              <button
                onClick={saveSports}
                disabled={savingSports || selectedSports.length === 0}
                className="w-full bg-violet-600 text-white py-3 px-4 rounded-md hover:bg-violet-700 transition font-medium disabled:opacity-50 mb-3"
              >
                {savingSports ? (
                  <><i className="fas fa-spinner fa-spin mr-2"></i>Saving…</>
                ) : (
                  'Continue'
                )}
              </button>
              <div className="text-center">
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
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Add a profile photo
              </h2>
              <p className="text-sm text-gray-600 mb-6">
                So other athletes recognize you.
              </p>

              <div className="flex justify-center mb-6">
                {profile?.avatar_url ? (
                  <LazyImage
                    src={profile.avatar_url}
                    alt="Your profile photo"
                    className="w-28 h-28 rounded-full object-cover border-4 border-violet-100"
                    width={112}
                    height={112}
                  />
                ) : (
                  <div className="w-28 h-28 rounded-full bg-violet-500 flex items-center justify-center text-white text-3xl font-bold border-4 border-violet-100">
                    {getInitials(displayName) || '?'}
                  </div>
                )}
              </div>

              {avatarError && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-md text-sm mb-4">
                  {avatarError}
                </div>
              )}

              <AvatarUploader
                mode="immediate"
                onError={message => setAvatarError(message)}
                onUploaded={async () => {
                  setAvatarError(null);
                  await refreshProfile();
                  setStep(3);
                }}
                render={({ open, uploading }) => (
                  <button
                    onClick={() => {
                      setAvatarError(null);
                      open();
                    }}
                    disabled={uploading}
                    className="w-full bg-violet-600 text-white py-3 px-4 rounded-md hover:bg-violet-700 transition font-medium disabled:opacity-50 mb-3"
                  >
                    {uploading ? (
                      <><i className="fas fa-spinner fa-spin mr-2"></i>Uploading…</>
                    ) : profile?.avatar_url ? (
                      'Change photo'
                    ) : (
                      'Choose a photo'
                    )}
                  </button>
                )}
              />
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                {profile?.avatar_url && (
                  <button
                    onClick={() => setStep(3)}
                    className="text-sm font-medium text-violet-600 hover:text-violet-700 min-h-[44px]"
                  >
                    Looks good — continue
                  </button>
                )}
                <button
                  onClick={() => setStep(3)}
                  className="text-sm text-gray-500 hover:text-gray-700 min-h-[44px]"
                >
                  Skip for now
                </button>
              </div>
              <div className="mt-2 text-center">
                <button
                  onClick={() => setStep(1)}
                  className="text-sm text-gray-500 hover:text-gray-700 min-h-[44px]"
                >
                  ← Back
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">Find athletes to follow</h2>
              <p className="text-sm text-gray-600 mb-4 text-center">
                Your feed comes alive when you follow a few people.
              </p>

              <div className="mb-6">
                <ConnectionSuggestions profileId={user.id} limit={5} compact />
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep(2)}
                  className="text-sm text-gray-500 hover:text-gray-700 min-h-[44px]"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="bg-violet-600 text-white py-2.5 px-6 rounded-md hover:bg-violet-700 transition font-medium min-h-[44px]"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="text-center">
              <div className="text-5xl mb-4 text-violet-600">
                <i className={primaryDef?.icon_id ?? 'fas fa-trophy'} aria-hidden="true"></i>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re all set!</h2>
              <p className="text-sm text-gray-600 mb-6">
                {primaryDef
                  ? `The best way to start: log your most recent ${primaryDef.display_name.toLowerCase()} activity. Your stats and trends build from there.`
                  : 'The best way to start: share your first post. Your profile builds from there.'}
              </p>

              <button
                onClick={() => finish(primarySport ? `/feed?create=1&sport=${primarySport}` : '/feed?create=1')}
                disabled={finishing}
                className="w-full bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700 transition font-semibold disabled:opacity-50 mb-3"
              >
                {finishing ? (
                  <><i className="fas fa-spinner fa-spin mr-2"></i>One sec…</>
                ) : (
                  <>
                    <i className={`${primaryDef?.icon_id ?? 'fas fa-plus'} mr-2`}></i>
                    {primaryDef?.primary_action ?? 'Create your first post'}
                  </>
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
                onClick={() => setStep(3)}
                className="mt-4 text-sm text-gray-500 hover:text-gray-700 min-h-[44px]"
              >
                ← Back
              </button>
            </div>
          )}

          {/* Always-available exit — onboarding resumes on next sign-in,
              so leaving loses nothing that isn't already saved. */}
          <div className="text-center mt-6 pt-4 border-t border-gray-100">
            <button
              onClick={() => signOut()}
              className="text-xs text-gray-400 hover:text-violet-600 hover:underline"
            >
              Sign out — you can finish this later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
