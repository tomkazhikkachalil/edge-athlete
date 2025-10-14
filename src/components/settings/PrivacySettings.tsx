'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';

export default function PrivacySettings() {
  const { profile, refreshProfile } = useAuth();
  const { showSuccess, showError } = useToast();
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile?.visibility) {
      setVisibility(profile.visibility as 'public' | 'private');
    }
  }, [profile]);

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
    } catch (error) {
      console.error('Error updating privacy:', error);
      showError('Error', 'Failed to update privacy settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Profile Visibility</h3>
        <p className="text-gray-600 text-sm mb-6">
          Control who can see your profile, posts, and athletic performance data.
        </p>

        <div className="space-y-4">
          {/* Public Option */}
          <button
            onClick={() => handleVisibilityChange('public')}
            disabled={saving}
            className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
              visibility === 'public'
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                visibility === 'public'
                  ? 'border-blue-600 bg-blue-600'
                  : 'border-gray-300'
              }`}>
                {visibility === 'public' && (
                  <i className="fas fa-check text-white text-xs"></i>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <i className="fas fa-globe text-blue-600"></i>
                  <h4 className="font-semibold text-gray-900">Public</h4>
                </div>
                <p className="text-sm text-gray-600">
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
                ? 'border-blue-600 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                visibility === 'private'
                  ? 'border-blue-600 bg-blue-600'
                  : 'border-gray-300'
              }`}>
                {visibility === 'private' && (
                  <i className="fas fa-check text-white text-xs"></i>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <i className="fas fa-lock text-purple-600"></i>
                  <h4 className="font-semibold text-gray-900">Private</h4>
                </div>
                <p className="text-sm text-gray-600">
                  Only approved followers can see your posts and stats. People must send a follow request to connect.
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Additional Privacy Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex gap-3">
          <i className="fas fa-info-circle text-blue-600 mt-0.5"></i>
          <div>
            <h4 className="font-medium text-blue-900 mb-1">Privacy Note</h4>
            <p className="text-sm text-blue-800">
              Your profile picture and name are always visible to help others find you.
              All other information respects your privacy settings.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
