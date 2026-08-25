'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import GuardiansCard from './GuardiansCard';
import SupervisedSettingCard from './SupervisedSettingCard';

export default function PrivacySettings() {
  const { profile, refreshProfile } = useAuth();
  const { showSuccess, showError } = useToast();
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [saving, setSaving] = useState(false);
  // Going public exposes everything instantly (indexed, seen, screenshotted)
  // — irreversible in effect, so it's never a single tap (dummy-proofing
  // round). Going private stays direct: it only ever narrows exposure.
  const [confirmingPublic, setConfirmingPublic] = useState(false);

  // Sync from the profile during render, not in an effect: the stale value
  // paints for a frame otherwise.
  const [syncedProfile, setSyncedProfile] = useState(profile);
  if (syncedProfile !== profile) {
    setSyncedProfile(profile);
    if (profile?.visibility) setVisibility(profile.visibility as 'public' | 'private');
  }

  const handleVisibilityChange = async (newVisibility: 'public' | 'private') => {
    try {
      setSaving(true);
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileData: { visibility: newVisibility },
          userId: profile?.id
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update privacy settings');
      }

      setVisibility(newVisibility);
      await refreshProfile();
      showSuccess('Success', 'Privacy settings updated successfully');
    } catch (e) {
      console.error('Failed to update privacy settings:', e);
      showError('Error', 'Failed to update privacy settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Supervised profiles see who manages them (renders nothing otherwise) */}
      <GuardiansCard />
      <div>
        <h3 className="text-lg font-semibold text-primary mb-4">Profile Visibility</h3>
        <p className="text-tertiary text-sm mb-6">
          Control who can see your profile, posts, and athletic performance data.
        </p>

        {profile?.supervision_state === 'supervised' ? (
          // Supervised profiles: visibility belongs to the guardian console.
          // The server strips it from self-service PUTs; show the posture
          // read-only instead of dead buttons.
          <SupervisedSettingCard
            icon={visibility === 'public' ? 'fa-globe' : 'fa-lock'}
            iconColor={visibility === 'public' ? 'text-brand-fg' : 'text-purple-600 dark:text-purple-400'}
            label={visibility === 'public' ? 'Public' : 'Private'}
            description={
              visibility === 'public'
                ? 'Anyone can see your profile, posts, and stats.'
                : 'Only approved followers can see your posts and stats.'
            }
          />
        ) : (
        <div className="space-y-4">
          {/* Public Option */}
          <button
            onClick={() => visibility !== 'public' && setConfirmingPublic(true)}
            disabled={saving}
            className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
              visibility === 'public'
                ? 'border-brand bg-brand-soft'
                : 'border-border hover:border-border-strong'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                visibility === 'public'
                  ? 'border-brand bg-brand'
                  : 'border-border-strong'
              }`}>
                {visibility === 'public' && (
                  <i className="fas fa-check text-white text-xs"></i>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <i className="fas fa-globe text-brand-fg"></i>
                  <h4 className="font-semibold text-primary">Public</h4>
                </div>
                <p className="text-sm text-tertiary">
                  Anyone can see your profile, posts, and stats. Your content may appear in search results.
                </p>
              </div>
            </div>
          </button>

          {/* Private Option */}
          <button
            onClick={() => handleVisibilityChange('private')}
            disabled={saving}
            className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
              visibility === 'private'
                ? 'border-brand bg-brand-soft'
                : 'border-border hover:border-border-strong'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                visibility === 'private'
                  ? 'border-brand bg-brand'
                  : 'border-border-strong'
              }`}>
                {visibility === 'private' && (
                  <i className="fas fa-check text-white text-xs"></i>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <i className="fas fa-lock text-purple-600 dark:text-purple-400"></i>
                  <h4 className="font-semibold text-primary">Private</h4>
                </div>
                <p className="text-sm text-tertiary">
                  Only approved followers can see your posts and stats. People must send a follow request to connect.
                </p>
              </div>
            </div>
          </button>
        </div>
        )}
      </div>

      {/* Additional Privacy Info */}
      <div className="bg-brand-soft border border-violet-200 dark:border-violet-800 rounded-lg p-4">
        <div className="flex gap-3">
          <i className="fas fa-info-circle text-brand-fg mt-0.5"></i>
          <div>
            <h4 className="font-medium text-violet-900 dark:text-violet-200 mb-1">Privacy Note</h4>
            <p className="text-sm text-violet-800 dark:text-violet-200">
              Your profile picture and name are always visible to help others find you.
              All other information respects your privacy settings.
            </p>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmingPublic}
        title="Make your profile public?"
        message="Everyone will immediately be able to see your profile, posts, and stats, and your content may appear in search results. You can go back to private anytime, but anything seen while public stays seen."
        confirmText="Go public"
        confirmButtonClass="bg-brand hover:bg-brand-hover"
        cancelText="Stay private"
        onConfirm={() => {
          setConfirmingPublic(false);
          void handleVisibilityChange('public');
        }}
        onCancel={() => setConfirmingPublic(false)}
      />
    </div>
  );
}
