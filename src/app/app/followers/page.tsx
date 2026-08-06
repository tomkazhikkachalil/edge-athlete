'use client';

import { useState, useEffect, Suspense } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import LazyImage from '@/components/LazyImage';
import { useToast } from '@/components/Toast';
import AppHeader from '@/components/AppHeader';

interface FollowerProfile {
  id: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  full_name?: string; // username/handle
  avatar_url?: string;
  sport?: string;
  school?: string;
}

interface Follower {
  id: string;
  created_at: string;
  follower?: FollowerProfile;
  following?: FollowerProfile;
}

interface FollowRequest {
  id: string;
  message?: string;
  created_at: string;
  follower: FollowerProfile;
}

function FollowersContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<'followers' | 'following' | 'requests'>(
    (searchParams.get('tab') as 'followers' | 'following' | 'requests') || 'followers'
  );
  const [followers, setFollowers] = useState<Follower[]>([]);
  const [following, setFollowing] = useState<Follower[]>([]);
  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTab]);

  // Hoisted function declaration, not a `const` arrow: the effect above calls
  // it, and react-hooks/immutability flags a reference to a binding declared
  // later in the body. Function declarations are hoisted and initialised, so
  // there is no temporal dead zone.
  async function loadData() {
    try {
      setLoading(true);
      const response = await fetch(`/api/followers?type=${activeTab}`);


      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }

        if (errorData?.details) {
          showError('Database Setup Required', errorData.details);
        } else {
          throw new Error(errorData?.error || `Failed to load data (${response.status})`);
        }
        return;
      }

      const data = await response.json();
      

      if (activeTab === 'followers') {
        setFollowers(data.followers || []);
      } else if (activeTab === 'following') {
        setFollowing(data.following || []);
      } else if (activeTab === 'requests') {
        setRequests(data.requests || []);
      }
    } catch (e) {
      console.error('Failed to load followers data:', e);
      showError('Error', 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  const handleAcceptRequest = async (followId: string) => {
    try {
      const response = await fetch('/api/followers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', followId })
      });

      if (!response.ok) throw new Error('Failed to accept request');

      setRequests(prev => prev.filter(r => r.id !== followId));
      showSuccess('Success', 'Fan request accepted');
      loadData(); // Reload to update counts
    } catch (e) {
      console.error('Failed to accept fan request:', e);
      showError('Error', 'Failed to accept request');
    }
  };

  const handleRejectRequest = async (followId: string) => {
    try {
      const response = await fetch('/api/followers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', followId })
      });

      if (!response.ok) throw new Error('Failed to reject request');

      setRequests(prev => prev.filter(r => r.id !== followId));
      showSuccess('Success', 'Fan request declined');
    } catch (e) {
      console.error('Failed to reject fan request:', e);
      showError('Error', 'Failed to reject request');
    }
  };

  if (authLoading || !user) {
    return null;
  }

  const handleUnfollow = async (profileId: string) => {
    if (!user) return;

    try {
      const response = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          followerId: user.id,
          followingId: profileId
        })
      });

      if (!response.ok) throw new Error('Failed to unfollow');

      showSuccess('Success', 'You are no longer a fan');
      loadData(); // Reload the lists
    } catch (e) {
      console.error('Failed to unfollow:', e);
      showError('Error', 'Failed to unfollow');
    }
  };

  const handleRemoveFollower = async (profileId: string) => {
    if (!user) return;

    try {
      // Remove means deleting their follow of you — the API anchors the
      // followed side to the session user, so only fanId is sent.
      const response = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_fan', fanId: profileId })
      });

      if (!response.ok) throw new Error('Failed to remove follower');

      showSuccess('Success', 'Fan removed');
      loadData(); // Reload the lists
    } catch (e) {
      console.error('Failed to remove fan:', e);
      showError('Error', 'Failed to remove follower');
    }
  };

  const renderProfileCard = (profile: FollowerProfile, showRemoveButton = false, showUnfollowButton = false) => {
    return (
      <div className="bg-surface rounded-lg border border-border p-4 hover:shadow-md transition-shadow">
        {/* flex-wrap + basis-40 on the name column: at 320px the Remove
            button wraps below instead of squeezing the name to a few
            characters (same pattern as FollowersModal). */}
        <div className="flex flex-wrap items-center gap-4">
          <button onClick={() => {
            // Navigate to own profile if clicking own profile
            if (user?.id === profile.id) {
              router.push('/athlete');
            } else {
              router.push(`/athlete/${profile.id}`);
            }
          }} className="flex-shrink-0">
            {profile.avatar_url ? (
              <LazyImage
                src={profile.avatar_url}
                alt={formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}
                className="w-16 h-16 rounded-full object-cover"
                width={64}
                height={64}
              />
            ) : (
              <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center">
                <span className="text-white text-xl font-semibold">
                  {getInitials(formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name))}
                </span>
              </div>
            )}
          </button>

          <div className="flex-1 basis-40 min-w-0">
            <button
              onClick={() => {
                // Navigate to own profile if clicking own profile
                if (user?.id === profile.id) {
                  router.push('/athlete');
                } else {
                  router.push(`/athlete/${profile.id}`);
                }
              }}
              className="font-bold text-primary hover:text-brand-fg truncate block max-w-full"
            >
              {formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}
            </button>
            {(profile.sport || profile.school) && (
              <p className="text-sm text-tertiary truncate">
                {profile.sport}
                {profile.sport && profile.school && ' • '}
                {profile.school}
              </p>
            )}
          </div>

          {showRemoveButton && (
            <button
              onClick={() => handleRemoveFollower(profile.id)}
              className="px-4 py-2 min-h-[40px] text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/60 transition-colors shrink-0"
            >
              Remove
            </button>
          )}

          {showUnfollowButton && (
            <button
              onClick={() => handleUnfollow(profile.id)}
              className="px-4 py-2 min-h-[40px] text-sm font-medium text-secondary bg-surface-sunken rounded-lg hover:bg-gray-200 dark:hover:bg-stone-800 transition-colors shrink-0"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-canvas">
      {/* Unified Header */}
      <AppHeader showSearch={false} />


      {/* Page Header with Tabs */}
      <div className="bg-surface border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => router.back()}
              className="ea-icon-btn inline-flex items-center justify-center -ml-2 text-tertiary hover:text-primary"
              aria-label="Go back"
            >
              <i className="fas fa-arrow-left text-xl"></i>
            </button>
            <h1 className="text-2xl font-bold text-primary">Connections</h1>
          </div>

          {/* Tabs — scrollable, not clipped: three tabs plus the count badge
              already brush 320px, and one more tab would silently vanish. */}
          <div className="flex gap-4 sm:gap-6 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setActiveTab('followers')}
              className={`shrink-0 whitespace-nowrap px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'followers'
                  ? 'border-brand text-brand-fg'
                  : 'border-transparent text-tertiary hover:text-primary'
              }`}
            >
              Fans
            </button>
            <button
              onClick={() => setActiveTab('following')}
              className={`shrink-0 whitespace-nowrap px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'following'
                  ? 'border-brand text-brand-fg'
                  : 'border-transparent text-tertiary hover:text-primary'
              }`}
            >
              Following
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`shrink-0 whitespace-nowrap px-2 py-2 text-sm font-medium border-b-2 transition-colors relative ${
                activeTab === 'requests'
                  ? 'border-brand text-brand-fg'
                  : 'border-transparent text-tertiary hover:text-primary'
              }`}
            >
              Fan Requests
              {requests.length > 0 && activeTab !== 'requests' && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                  {requests.length > 9 ? '9+' : requests.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="text-center py-12">
            <i className="fas fa-spinner fa-spin text-3xl text-faint mb-3"></i>
            <p className="text-tertiary">Loading...</p>
          </div>
        ) : (
          <>
            {/* Followers Tab */}
            {activeTab === 'followers' && (
              <div className="space-y-3">
                {followers.length === 0 ? (
                  <div className="bg-surface rounded-lg shadow-sm border border-border p-12 text-center">
                    <i className="fas fa-users text-6xl text-gray-300 dark:text-stone-600 mb-4"></i>
                    <h3 className="text-xl font-bold text-primary mb-2">No fans yet</h3>
                    <p className="text-tertiary">When people become your fans, they&apos;ll appear here.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {followers.map((f) => {
                      if (!f.follower) return null;
                      return <div key={f.id}>{renderProfileCard(f.follower, true, false)}</div>;
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Following Tab */}
            {activeTab === 'following' && (
              <div className="space-y-3">
                {following.length === 0 ? (
                  <div className="bg-surface rounded-lg shadow-sm border border-border p-12 text-center">
                    <i className="fas fa-user-friends text-6xl text-gray-300 dark:text-stone-600 mb-4"></i>
                    <h3 className="text-xl font-bold text-primary mb-2">Not a fan of anyone yet</h3>
                    <p className="text-tertiary">Find athletes to become a fan of and see their activity.</p>
                  </div>
                ) : (
                  <>
                    {following.map(f => {
                      if (!f.following) {
                        return null;
                      }
                      return <div key={f.id}>{renderProfileCard(f.following, false, true)}</div>;
                    })}
                  </>
                )}
              </div>
            )}

            {/* Requests Tab */}
            {activeTab === 'requests' && (
              <div className="space-y-3">
                {requests.length === 0 ? (
                  <div className="bg-surface rounded-lg shadow-sm border border-border p-12 text-center">
                    <i className="fas fa-user-clock text-6xl text-gray-300 dark:text-stone-600 mb-4"></i>
                    <h3 className="text-xl font-bold text-primary mb-2">No pending fan requests</h3>
                    <p className="text-tertiary">Fan requests will appear here.</p>
                  </div>
                ) : (
                  requests.map(request => {
                    // Safety check for null follower
                    if (!request.follower) {
                      return null;
                    }

                    return (
                      <div key={request.id} className="bg-surface rounded-lg border border-border p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-start gap-4">
                          <button onClick={() => {
                            // Navigate to own profile if clicking own profile
                            if (user?.id === request.follower.id) {
                              router.push('/athlete');
                            } else {
                              router.push(`/athlete/${request.follower.id}`);
                            }
                          }} className="flex-shrink-0">
                            {request.follower.avatar_url ? (
                              <LazyImage
                                src={request.follower.avatar_url}
                                alt={formatDisplayName(request.follower.first_name, null, request.follower.last_name, request.follower.full_name)}
                                className="w-16 h-16 rounded-full object-cover"
                                width={64}
                                height={64}
                              />
                            ) : (
                              <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center">
                                <span className="text-white text-xl font-semibold">
                                  {getInitials(formatDisplayName(request.follower.first_name, null, request.follower.last_name, request.follower.full_name))}
                                </span>
                              </div>
                            )}
                          </button>

                          <div className="flex-1 min-w-0">
                            <button
                              onClick={() => {
                                // Navigate to own profile if clicking own profile
                                if (user?.id === request.follower.id) {
                                  router.push('/athlete');
                                } else {
                                  router.push(`/athlete/${request.follower.id}`);
                                }
                              }}
                              className="font-bold text-primary hover:text-brand-fg truncate block"
                            >
                              {formatDisplayName(request.follower.first_name, null, request.follower.last_name, request.follower.full_name)}
                            </button>
                            {(request.follower.sport || request.follower.school) && (
                              <p className="text-sm text-tertiary truncate">
                                {request.follower.sport}
                                {request.follower.sport && request.follower.school && ' • '}
                                {request.follower.school}
                              </p>
                            )}
                            {request.message && (
                              <p className="text-sm text-secondary mt-2 italic bg-surface-muted p-3 rounded">
                                &quot;{request.message}&quot;
                              </p>
                            )}

                            {/* Action Buttons — equal halves so both stay
                                comfortably tappable in the narrow column the
                                request card leaves at 320px. */}
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() => handleAcceptRequest(request.id)}
                                className="flex-1 sm:flex-none px-4 py-2 min-h-[40px] bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-hover transition-colors"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => handleRejectRequest(request.id)}
                                className="flex-1 sm:flex-none px-4 py-2 min-h-[40px] bg-gray-200 dark:bg-stone-800 text-secondary text-sm font-medium rounded-lg hover:bg-gray-300 dark:hover:bg-stone-700 transition-colors"
                              >
                                Decline
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function FollowersPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <i className="fas fa-spinner fa-spin text-3xl text-faint"></i>
      </div>
    }>
      <FollowersContent />
    </Suspense>
  );
}
