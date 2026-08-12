'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { getHandle } from '@/lib/profile-display';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

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

  // NOTE: the loading/error reset lives in the render-phase open sync below,
  // not here — setting it synchronously from the effect that calls this is the
  // cascading render react-hooks/set-state-in-effect exists to prevent. This
  // has exactly one caller, so the two are equivalent.

  // Tab selection is state synchronisation (render phase); the fetch is a real
  // side effect (stays in an effect).
  const [syncedOpen, setSyncedOpen] = useState({ isOpen, initialTab, profileId });
  if (
    syncedOpen.isOpen !== isOpen ||
    syncedOpen.initialTab !== initialTab ||
    syncedOpen.profileId !== profileId
  ) {
    setSyncedOpen({ isOpen, initialTab, profileId });
    if (isOpen) {
      setActiveTab(initialTab);
      setLoading(true);
      setError(null);
    }
  }

  // Loader defined inside the effect (that is what clears the rule) and
  // published on a ref so the retry button can still call it. It keeps its
  // own requestSeqRef staleness guard.
  const loadDataRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!isOpen) return;
    const run = async () => {
        const seq = ++requestSeqRef.current;

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
    };
    loadDataRef.current = run;
    run();
  }, [isOpen, profileId, user]);

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

  // Refcounted lock, not a hand-rolled body.style.overflow: the manual
  // version fights any other open overlay's cleanup when modals stack.
  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleEscKey);
    }

    return () => {
      window.removeEventListener('keydown', handleEscKey);
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

      {/* Modal Content. flex-col + max-h-modal (dvh-aware): the old
          max-h-[80vh] panel with a max-h-[calc(80vh-140px)] list relied on a
          magic 140px header estimate that broke as soon as the header grew. */}
      <div className="relative w-full max-w-lg max-h-modal bg-surface-raised rounded-lg shadow-xl overflow-hidden mx-4 flex flex-col">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-xl font-bold text-primary">
            {activeTab === 'followers' ? 'Fans' : 'Following'}
          </h2>
          <button
            onClick={onClose}
            className="ea-icon-btn inline-flex items-center justify-center text-primary hover:text-black dark:hover:text-primary"
            aria-label="Close"
          >
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex border-b border-border">
          <button
            onClick={() => setActiveTab('followers')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'followers'
                ? 'text-brand-fg border-b-2 border-brand'
                : 'text-tertiary hover:text-primary'
            }`}
          >
            Fans ({followers.length})
          </button>
          <button
            onClick={() => setActiveTab('following')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'following'
                ? 'text-brand-fg border-b-2 border-brand'
                : 'text-tertiary hover:text-primary'
            }`}
          >
            Following ({following.length})
          </button>
        </div>

        {/* Content — the panel's only scroll area; min-h-0 lets it shrink
            below its content height so it actually scrolls. */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <div className="text-red-500 mb-4">
                <i className="fas fa-exclamation-circle text-4xl"></i>
              </div>
              <p className="text-primary font-medium">{error}</p>
              <button
                onClick={() => loadDataRef.current()}
                className="mt-4 px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover"
              >
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && currentList.length === 0 && (
            <div className="text-center py-12">
              <div className="text-tertiary mb-4">
                <i className="fas fa-users text-4xl"></i>
              </div>
              <p className="text-primary font-medium">
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
                    className="flex flex-wrap items-center gap-3 p-3 rounded-lg hover:bg-surface-muted transition-colors"
                  >
                    {/* Clickable profile section. basis-40 sets the wrap
                        threshold: on your own Fans tab the row carries TWO
                        pill buttons (~200px) — below ~360px they drop to
                        their own line instead of squeezing the name to
                        nothing. */}
                    <button
                      onClick={() => handleProfileClick(profile.id)}
                      className="flex items-center gap-3 flex-1 basis-40 min-w-0 text-left"
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
                          <p className="font-semibold text-primary truncate">
                            {displayName}
                          </p>
                          {handle && (
                            <span className="text-sm text-muted truncate">{handle}</span>
                          )}
                        </div>
                        {(profile.sport || profile.school) && (
                          <p className="text-sm text-tertiary truncate">
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
                                className="px-3 py-2 min-h-[44px] text-xs font-medium text-secondary bg-gray-200 dark:bg-stone-800 rounded-full hover:bg-gray-300 dark:hover:bg-stone-700 transition-colors disabled:opacity-50 whitespace-nowrap"
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
                                className={`px-3 py-2 min-h-[44px] text-xs font-medium rounded-full transition-colors disabled:opacity-50 whitespace-nowrap ${
                                  requestedThem
                                    ? 'text-secondary bg-gray-200 dark:bg-stone-800 hover:bg-gray-300 dark:hover:bg-stone-700'
                                    : 'text-white bg-brand hover:bg-brand-hover'
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
                                className="px-3 py-2 min-h-[44px] text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 rounded-full hover:bg-red-100 dark:hover:bg-red-950/60 transition-colors disabled:opacity-50 whitespace-nowrap"
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
                                className="px-3 py-2 min-h-[44px] text-xs font-medium text-secondary bg-gray-200 dark:bg-stone-800 rounded-full hover:bg-gray-300 dark:hover:bg-stone-700 transition-colors disabled:opacity-50 whitespace-nowrap"
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
                                className={`px-3 py-2 min-h-[44px] text-xs font-medium rounded-full transition-colors disabled:opacity-50 whitespace-nowrap ${
                                  requestedThem
                                    ? 'text-secondary bg-gray-200 dark:bg-stone-800 hover:bg-gray-300 dark:hover:bg-stone-700'
                                    : 'text-white bg-brand hover:bg-brand-hover'
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
