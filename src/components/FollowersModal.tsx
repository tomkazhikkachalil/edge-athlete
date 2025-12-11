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
  const [myFollowing, setMyFollowing] = useState<Set<string>>(new Set()); // IDs of people I'm a fan of
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // Track which button is loading

  // Is this the current user's own profile?
  const isOwnProfile = user?.id === profileId;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch followers of the profile being viewed
      const followersResponse = await fetch(`/api/followers?profileId=${profileId}&type=followers`);
      if (!followersResponse.ok) {
        throw new Error('Failed to load fans');
      }
      const followersData = await followersResponse.json();

      // Fetch following of the profile being viewed
      const followingResponse = await fetch(`/api/followers?profileId=${profileId}&type=following`);
      if (!followingResponse.ok) {
        throw new Error('Failed to load fan of list');
      }
      const followingData = await followingResponse.json();

      // Extract profile data from nested structure
      const followersProfiles = (followersData.followers || []).map((item: { follower?: Profile }) => item.follower).filter(Boolean);
      const followingProfiles = (followingData.following || []).map((item: { following?: Profile }) => item.following).filter(Boolean);

      setFollowers(followersProfiles);
      setFollowing(followingProfiles);

      // If viewing someone else's profile, also fetch who I'm following
      // to show "You're a Fan" / "Become a Fan" status
      if (user && !isOwnProfile) {
        const myFollowingResponse = await fetch(`/api/followers?profileId=${user.id}&type=following`);
        if (myFollowingResponse.ok) {
          const myFollowingData = await myFollowingResponse.json();
          const myFollowingIds = new Set(
            (myFollowingData.following || [])
              .map((item: { following?: Profile }) => item.following?.id)
              .filter(Boolean)
          );
          setMyFollowing(myFollowingIds as Set<string>);
        }
      } else if (isOwnProfile) {
        // On own profile, "following" list IS who I'm a fan of
        const myFollowingIds = new Set<string>(followingProfiles.map((p: Profile) => p.id));
        setMyFollowing(myFollowingIds);
      }
    } catch {
      setError('Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [profileId, user, isOwnProfile]);

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

  const handleBecomeFan = async (targetId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger row click
    if (!user) return;

    setActionLoading(targetId);
    try {
      const response = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          followerId: user.id,
          followingId: targetId
        })
      });

      if (!response.ok) throw new Error('Failed to become a fan');

      const data = await response.json();

      // Update local state
      if (data.action === 'followed') {
        setMyFollowing(prev => new Set([...prev, targetId]));
      }
    } catch {
      // Silently fail - user can try again
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveFan = async (fanId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger row click
    if (!user || !isOwnProfile) return;

    setActionLoading(fanId);
    try {
      // Remove means deleting their follow of you
      const response = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          followerId: fanId,    // They are the follower/fan
          followingId: user.id  // You are being followed
        })
      });

      if (!response.ok) throw new Error('Failed to remove fan');

      // Update local state - remove from followers list
      setFollowers(prev => prev.filter(p => p.id !== fanId));
    } catch {
      // Silently fail - user can try again
    } finally {
      setActionLoading(null);
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
            {activeTab === 'followers' ? 'Fans' : 'Fan Of'}
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
            Fans ({followers.length})
          </button>
          <button
            onClick={() => setActiveTab('following')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'following'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Fan Of ({following.length})
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
                  ? 'No fans yet'
                  : 'Not a fan of anyone yet'}
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
                const isMe = user?.id === profile.id;
                const amFanOfThem = myFollowing.has(profile.id);
                const isLoadingThis = actionLoading === profile.id;

                return (
                  <div
                    key={profile.id}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {/* Clickable profile section */}
                    <button
                      onClick={() => handleProfileClick(profile.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      {/* Avatar */}
                      {profile.avatar_url ? (
                        <Image
                          src={profile.avatar_url}
                          alt={displayName || 'User'}
                          width={48}
                          height={48}
                          className="rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold flex-shrink-0">
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
                            <span className="text-sm text-gray-500 truncate">{handle}</span>
                          )}
                        </div>
                        {(profile.sport || profile.school) && (
                          <p className="text-sm text-gray-600 truncate">
                            {[profile.sport, profile.school].filter(Boolean).join(' • ')}
                          </p>
                        )}
                      </div>
                    </button>

                    {/* Action buttons - only show for others, not yourself */}
                    {!isMe && user && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Fans tab: Show "Become a Fan" / "You're a Fan" + Remove (if own profile) */}
                        {activeTab === 'followers' && (
                          <>
                            {/* Fan back button */}
                            {amFanOfThem ? (
                              <span className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 rounded-full whitespace-nowrap">
                                <i className="fas fa-heart mr-1"></i>
                                You&apos;re a Fan
                              </span>
                            ) : (
                              <button
                                onClick={(e) => handleBecomeFan(profile.id, e)}
                                disabled={isLoadingThis}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-full hover:bg-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                              >
                                {isLoadingThis ? (
                                  <i className="fas fa-spinner fa-spin"></i>
                                ) : (
                                  <>
                                    <i className="fas fa-heart mr-1"></i>
                                    Become a Fan
                                  </>
                                )}
                              </button>
                            )}

                            {/* Remove fan - only on own profile */}
                            {isOwnProfile && (
                              <button
                                onClick={(e) => handleRemoveFan(profile.id, e)}
                                disabled={isLoadingThis}
                                className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                                title="Remove fan"
                              >
                                <i className="fas fa-times"></i>
                              </button>
                            )}
                          </>
                        )}

                        {/* Fan Of tab: Show "Become a Fan" for people in someone else's Fan Of list */}
                        {activeTab === 'following' && !isOwnProfile && (
                          <>
                            {amFanOfThem ? (
                              <span className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 rounded-full whitespace-nowrap">
                                <i className="fas fa-heart mr-1"></i>
                                You&apos;re a Fan
                              </span>
                            ) : (
                              <button
                                onClick={(e) => handleBecomeFan(profile.id, e)}
                                disabled={isLoadingThis}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-full hover:bg-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                              >
                                {isLoadingThis ? (
                                  <i className="fas fa-spinner fa-spin"></i>
                                ) : (
                                  <>
                                    <i className="fas fa-heart mr-1"></i>
                                    Become a Fan
                                  </>
                                )}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
