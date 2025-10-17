'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { getHandle } from '@/lib/profile-display';

interface Profile {
  id: string;
  first_name: string | null;
  middle_name?: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle?: string | null;
  sport?: string | null;
  school?: string | null;
}

interface FollowersModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string;
  initialTab?: 'followers' | 'following';
}

export default function FollowersModal({ isOpen, onClose, profileId, initialTab = 'followers' }: FollowersModalProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'followers' | 'following'>(initialTab);
  const [followers, setFollowers] = useState<Profile[]>([]);
  const [following, setFollowing] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch followers
      const followersResponse = await fetch(`/api/followers?profileId=${profileId}&type=followers`);
      if (!followersResponse.ok) {
        throw new Error('Failed to load followers');
      }
      const followersData = await followersResponse.json();

      // Fetch following
      const followingResponse = await fetch(`/api/followers?profileId=${profileId}&type=following`);
      if (!followingResponse.ok) {
        throw new Error('Failed to load following');
      }
      const followingData = await followingResponse.json();

      // Extract profile data from nested structure
      const followersProfiles = (followersData.followers || []).map((item: { follower?: Profile }) => item.follower).filter(Boolean);
      const followingProfiles = (followingData.following || []).map((item: { following?: Profile }) => item.following).filter(Boolean);

      setFollowers(followersProfiles);
      setFollowing(followingProfiles);
    } catch (err) {
      console.error('Error loading followers/following:', err);
      setError('Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      loadData();
    }
  }, [isOpen, initialTab, loadData]);

  const handleProfileClick = (id: string) => {
    onClose();
    // Navigate to own profile if clicking own profile
    if (user?.id === id) {
      router.push('/athlete');
    } else {
      router.push(`/athlete/${id}`);
    }
  };

  const handleEscKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      onClose();
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleEscKey);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      window.removeEventListener('keydown', handleEscKey);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleEscKey]);

  if (!isOpen) return null;

  const currentList = activeTab === 'followers' ? followers : following;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-lg max-h-[80vh] bg-white rounded-lg shadow-xl overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">
            {activeTab === 'followers' ? 'Followers' : 'Following'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-800 hover:text-black transition-colors"
            aria-label="Close"
          >
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('followers')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'followers'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Followers ({followers.length})
          </button>
          <button
            onClick={() => setActiveTab('following')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'following'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Following ({following.length})
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(80vh-140px)] p-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <div className="text-red-500 mb-4">
                <i className="fas fa-exclamation-circle text-4xl"></i>
              </div>
              <p className="text-gray-900 font-medium">{error}</p>
              <button
                onClick={loadData}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && currentList.length === 0 && (
            <div className="text-center py-12">
              <div className="text-gray-600 mb-4">
                <i className="fas fa-users text-4xl"></i>
              </div>
              <p className="text-gray-900 font-medium">
                {activeTab === 'followers'
                  ? 'No followers yet'
                  : 'Not following anyone yet'}
              </p>
            </div>
          )}

          {!loading && !error && currentList.length > 0 && (
            <div className="space-y-3">
              {currentList.map((profile) => {
                const displayName = formatDisplayName(
                  profile.first_name,
                  null,
                  profile.last_name,
                  profile.full_name
                );
                const handle = getHandle(profile);

                return (
                  <button
                    key={profile.id}
                    onClick={() => handleProfileClick(profile.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
                  >
                    {/* Avatar */}
                    {profile.avatar_url ? (
                      <Image
                        src={profile.avatar_url}
                        alt={displayName || 'User'}
                        width={48}
                        height={48}
                        className="rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold">
                        {getInitials(displayName)}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900 truncate">
                          {displayName}
                        </p>
                        {handle && (
                          <span className="text-sm text-gray-900 font-medium">{handle}</span>
                        )}
                      </div>
                      {(profile.sport || profile.school) && (
                        <p className="text-sm text-gray-900 truncate">
                          {[profile.sport, profile.school].filter(Boolean).join(' • ')}
                        </p>
                      )}
                    </div>

                    {/* Arrow */}
                    <i className="fas fa-chevron-right text-gray-700"></i>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
