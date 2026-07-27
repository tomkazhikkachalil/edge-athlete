'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [myPending, setMyPending] = useState<Set<string>>(new Set()); // IDs with an outgoing pending request
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // Track which button is loading

  // Is this the current user's own profile?
  const isOwnProfile = user?.id === profileId;

  // Guards against out-of-order responses when the modal is reopened for a
  // different profile while a previous load is still in flight.
  const requestSeqRef = useRef(0);

  const loadData = useCallback(async () => {
    const seq = ++requestSeqRef.current;
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

      if (seq !== requestSeqRef.current) return; // stale response
      setFollowers(followersProfiles);
      setFollowing(followingProfiles);

      // Fetch my own follow states WITH pending status, so a pending fan
      // request renders as "Requested" instead of being conflated with
      // not-following (clicking "Become a Fan" on a pending target silently
      // cancelled the request).
      if (user) {
        const myStatesResponse = await fetch(`/api/followers?profileId=${user.id}&type=following&includeStatus=true`);
        if (myStatesResponse.ok) {
          const myStatesData = await myStatesResponse.json();
          const accepted = new Set<string>();
          const pending = new Set<string>();
          for (const item of (myStatesData.following || []) as Array<{ status?: string; following?: Profile }>) {
            const id = item.following?.id;
            if (!id) continue;
            if (item.status === 'pending') pending.add(id);
            else accepted.add(id);
          }
          if (seq !== requestSeqRef.current) return; // stale response
          setMyFollowing(accepted);
          setMyPending(pending);
        }
      }
    } catch (e) {
      console.error('Failed to load fan/following data:', e);
      setError('Failed to load data. Please try again.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [profileId, user]);

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

      // Update local state. A follow of a private profile is only a REQUEST
      // (isPending) — track it separately so the button shows "Requested".
      if (data.action === 'followed') {
        if (data.isPending) {
          setMyPending(prev => new Set([...prev, targetId]));
        } else {
          setMyFollowing(prev => new Set([...prev, targetId]));
        }
      } else if (data.action === 'unfollowed') {
        // Toggled off a pending request (button showed "Requested")
        setMyPending(prev => { const n = new Set(prev); n.delete(targetId); return n; });
      }
    } catch (e) {
      console.error('Failed to become fan:', e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnfollow = async (targetId: string, e: React.MouseEvent) => {
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

      if (!response.ok) throw new Error('Failed to unfollow');

      const data = await response.json();

      // Update local state - remove from myFollowing
      if (data.action === 'unfollowed') {
        setMyFollowing(prev => {
          const newSet = new Set(prev);
          newSet.delete(targetId);
          return newSet;
        });
        setMyPending(prev => { const n = new Set(prev); n.delete(targetId); return n; });
      }
    } catch (e) {
      console.error('Failed to unfollow:', e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveFan = async (fanId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger row click
    if (!user || !isOwnProfile) return;

    setActionLoading(fanId);
    try {
      // Remove means deleting their follow of you — the API anchors the
      // followed side to the session user, so only fanId is sent.
      const response = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_fan', fanId })
      });

      if (!response.ok) throw new Error('Failed to remove fan');

      // Update local state - remove from followers list
      setFollowers(prev => prev.filter(p => p.id !== fanId));
    } catch (e) {
      console.error('Failed to remove fan:', e);
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
        className="absolute inset-0 bg-black/50"
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
                ? 'text-violet-600 border-b-2 border-violet-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Fans ({followers.length})
          </button>
          <button
            onClick={() => setActiveTab('following')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'following'
                ? 'text-violet-600 border-b-2 border-violet-600'
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
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600"></div>
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
                className="mt-4 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700"
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
                const requestedThem = myPending.has(profile.id);
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
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-semibold flex-shrink-0">
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

                    {/* Action buttons - always visible for others, not yourself */}
                    {!isMe && user && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Fans tab: Show "Become a Fan" or "Unfollow" + "Remove Fan" (if own profile) */}
                        {activeTab === 'followers' && (
                          <>
                            {/* Fan/Unfollow button - always visible */}
                            {amFanOfThem ? (
                              <button
                                onClick={(e) => handleUnfollow(profile.id, e)}
                                disabled={isLoadingThis}
                                className="px-3 py-2 min-h-[36px] text-xs font-medium text-gray-700 bg-gray-200 rounded-full hover:bg-gray-300 transition-colors disabled:opacity-50 whitespace-nowrap"
                              >
                                {isLoadingThis ? (
                                  <i className="fas fa-spinner fa-spin"></i>
                                ) : (
                                  'Unfollow'
                                )}
                              </button>
                            ) : (
                              <button
                                onClick={(e) => handleBecomeFan(profile.id, e)}
                                disabled={isLoadingThis}
                                className={`px-3 py-2 min-h-[36px] text-xs font-medium rounded-full transition-colors disabled:opacity-50 whitespace-nowrap ${
                                  requestedThem
                                    ? 'text-gray-700 bg-gray-200 hover:bg-gray-300'
                                    : 'text-white bg-violet-600 hover:bg-violet-700'
                                }`}
                              >
                                {isLoadingThis ? (
                                  <i className="fas fa-spinner fa-spin"></i>
                                ) : requestedThem ? (
                                  'Requested'
                                ) : (
                                  'Become a Fan'
                                )}
                              </button>
                            )}

                            {/* Remove Fan - only on own profile, always visible */}
                            {isOwnProfile && (
                              <button
                                onClick={(e) => handleRemoveFan(profile.id, e)}
                                disabled={isLoadingThis}
                                className="px-3 py-2 min-h-[36px] text-xs font-medium text-red-600 bg-red-50 rounded-full hover:bg-red-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                              >
                                Remove Fan
                              </button>
                            )}
                          </>
                        )}

                        {/* Fan Of tab: Show "Become a Fan" or "Unfollow" */}
                        {activeTab === 'following' && (
                          <>
                            {amFanOfThem ? (
                              <button
                                onClick={(e) => handleUnfollow(profile.id, e)}
                                disabled={isLoadingThis}
                                className="px-3 py-2 min-h-[36px] text-xs font-medium text-gray-700 bg-gray-200 rounded-full hover:bg-gray-300 transition-colors disabled:opacity-50 whitespace-nowrap"
                              >
                                {isLoadingThis ? (
                                  <i className="fas fa-spinner fa-spin"></i>
                                ) : (
                                  'Unfollow'
                                )}
                              </button>
                            ) : (
                              <button
                                onClick={(e) => handleBecomeFan(profile.id, e)}
                                disabled={isLoadingThis}
                                className={`px-3 py-2 min-h-[36px] text-xs font-medium rounded-full transition-colors disabled:opacity-50 whitespace-nowrap ${
                                  requestedThem
                                    ? 'text-gray-700 bg-gray-200 hover:bg-gray-300'
                                    : 'text-white bg-violet-600 hover:bg-violet-700'
                                }`}
                              >
                                {isLoadingThis ? (
                                  <i className="fas fa-spinner fa-spin"></i>
                                ) : requestedThem ? (
                                  'Requested'
                                ) : (
                                  'Become a Fan'
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
