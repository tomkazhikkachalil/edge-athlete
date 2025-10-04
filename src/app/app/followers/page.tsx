'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import LazyImage from '@/components/LazyImage';
import FollowButton from '@/components/FollowButton';
import { ToastContainer, useToast } from '@/components/Toast';

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

export default function FollowersPage() {
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
  const { toasts, dismissToast, showSuccess, showError } = useToast();

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

  const loadData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/followers?type=${activeTab}`);

      console.log('[FOLLOWERS PAGE] Response status:', response.status);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
          console.error('[FOLLOWERS PAGE] API Error:', errorData);
        } catch (jsonError) {
          console.error('[FOLLOWERS PAGE] Failed to parse error JSON:', jsonError);
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
      console.log('[FOLLOWERS PAGE] Data received:', {
        type: activeTab,
        count: data.followers?.length || data.following?.length || data.requests?.length || 0,
        rawData: data
      });

      if (activeTab === 'followers') {
        console.log('[FOLLOWERS PAGE] Setting followers:', data.followers);
        setFollowers(data.followers || []);
      } else if (activeTab === 'following') {
        console.log('[FOLLOWERS PAGE] Setting following:', data.following);
        setFollowing(data.following || []);
      } else if (activeTab === 'requests') {
        console.log('[FOLLOWERS PAGE] Setting requests:', data.requests);
        setRequests(data.requests || []);
      }
    } catch (error) {
      console.error('[FOLLOWERS PAGE] Error loading data:', error);
      showError('Error', error instanceof Error ? error.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptRequest = async (followId: string) => {
    try {
      const response = await fetch('/api/followers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', followId })
      });

      if (!response.ok) throw new Error('Failed to accept request');

      setRequests(prev => prev.filter(r => r.id !== followId));
      showSuccess('Success', 'Follow request accepted');
      loadData(); // Reload to update counts
    } catch (error) {
      console.error('Error accepting request:', error);
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
      showSuccess('Success', 'Follow request rejected');
    } catch (error) {
      console.error('Error rejecting request:', error);
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

      showSuccess('Success', 'Unfollowed successfully');
      loadData(); // Reload the lists
    } catch (error) {
      console.error('Error unfollowing:', error);
      showError('Error', 'Failed to unfollow');
    }
  };

  const handleRemoveFollower = async (profileId: string) => {
    if (!user) return;

    try {
      // Remove means deleting their follow of you
      const response = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          followerId: profileId,  // They are the follower
          followingId: user.id    // You are being followed
        })
      });

      if (!response.ok) throw new Error('Failed to remove follower');

      showSuccess('Success', 'Follower removed');
      loadData(); // Reload the lists
    } catch (error) {
      console.error('Error removing follower:', error);
      showError('Error', 'Failed to remove follower');
    }
  };

  const renderProfileCard = (profile: FollowerProfile, showRemoveButton = false, showUnfollowButton = false) => {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push(`/athlete/${profile.id}`)} className="flex-shrink-0">
            {profile.avatar_url ? (
              <LazyImage
                src={profile.avatar_url}
                alt={formatDisplayName(profile.first_name, profile.middle_name, profile.last_name, profile.full_name)}
                className="w-16 h-16 rounded-full object-cover"
                width={64}
                height={64}
              />
            ) : (
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <span className="text-white text-xl font-semibold">
                  {getInitials(formatDisplayName(profile.first_name, profile.middle_name, profile.last_name, profile.full_name))}
                </span>
              </div>
            )}
          </button>

          <div className="flex-1 min-w-0">
            <button
              onClick={() => router.push(`/athlete/${profile.id}`)}
              className="font-bold text-gray-900 hover:text-blue-600 truncate block"
            >
              {formatDisplayName(profile.first_name, profile.middle_name, profile.last_name, profile.full_name)}
            </button>
            {(profile.sport || profile.school) && (
              <p className="text-sm text-gray-600 truncate">
                {profile.sport}
                {profile.sport && profile.school && ' • '}
                {profile.school}
              </p>
            )}
          </div>

          {showRemoveButton && (
            <button
              onClick={() => handleRemoveFollower(profile.id)}
              className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
            >
              Remove
            </button>
          )}

          {showUnfollowButton && (
            <button
              onClick={() => handleUnfollow(profile.id)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Unfollow
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="text-gray-600 hover:text-gray-900"
            >
              <i className="fas fa-arrow-left text-xl"></i>
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Connections</h1>
          </div>

          {/* Tabs */}
          <div className="flex gap-6 mt-4">
            <button
              onClick={() => setActiveTab('followers')}
              className={`px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'followers'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Followers
            </button>
            <button
              onClick={() => setActiveTab('following')}
              className={`px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'following'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Following
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`px-2 py-2 text-sm font-medium border-b-2 transition-colors relative ${
                activeTab === 'requests'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Requests
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
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading ? (
          <div className="text-center py-12">
            <i className="fas fa-spinner fa-spin text-3xl text-gray-400 mb-3"></i>
            <p className="text-gray-600">Loading...</p>
          </div>
        ) : (
          <>
            {/* Followers Tab */}
            {activeTab === 'followers' && (
              <div className="space-y-3">
                {console.log('[FOLLOWERS TAB] followers.length =', followers.length, 'followers array:', followers)}
                {followers.length === 0 ? (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                    <i className="fas fa-users text-6xl text-gray-300 mb-4"></i>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">No followers yet</h3>
                    <p className="text-gray-600">When people follow you, they&apos;ll appear here.</p>
                    <p className="text-xs text-gray-400 mt-2">Debug: {followers.length} followers in state</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {console.log('[FOLLOWERS RENDER] About to render', followers.length, 'items')}
                    {followers.map((f, index) => {
                      console.log(`[FOLLOWERS RENDER] Item ${index}:`, f);
                      if (!f.follower) {
                        console.error('[FOLLOWERS PAGE] Follower missing profile data at index', index, ':', f);
                        return <div key={f.id} className="bg-red-100 p-4 rounded">Missing follower data for ID: {f.id}</div>;
                      }
                      console.log(`[FOLLOWERS RENDER] Rendering follower ${index}:`, f.follower.first_name, f.follower.last_name);
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
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                    <i className="fas fa-user-friends text-6xl text-gray-300 mb-4"></i>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Not following anyone</h3>
                    <p className="text-gray-600">Find athletes to follow and see their activity.</p>
                  </div>
                ) : (
                  <>
                    {console.log('[FOLLOWING RENDER] Rendering', following.length, 'following:', following)}
                    {following.map(f => {
                      if (!f.following) {
                        console.warn('[FOLLOWERS PAGE] Following missing profile data:', f);
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
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                    <i className="fas fa-user-clock text-6xl text-gray-300 mb-4"></i>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">No pending requests</h3>
                    <p className="text-gray-600">Follow requests will appear here.</p>
                  </div>
                ) : (
                  requests.map(request => {
                    // Safety check for null follower
                    if (!request.follower) {
                      console.warn('[FOLLOWERS PAGE] Request with null follower:', request);
                      return null;
                    }

                    return (
                      <div key={request.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-start gap-4">
                          <button onClick={() => router.push(`/athlete/${request.follower.id}`)} className="flex-shrink-0">
                            {request.follower.avatar_url ? (
                              <LazyImage
                                src={request.follower.avatar_url}
                                alt={formatDisplayName(request.follower.first_name, request.follower.middle_name, request.follower.last_name, request.follower.full_name)}
                                className="w-16 h-16 rounded-full object-cover"
                                width={64}
                                height={64}
                              />
                            ) : (
                              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                                <span className="text-white text-xl font-semibold">
                                  {getInitials(formatDisplayName(request.follower.first_name, request.follower.middle_name, request.follower.last_name, request.follower.full_name))}
                                </span>
                              </div>
                            )}
                          </button>

                          <div className="flex-1 min-w-0">
                            <button
                              onClick={() => router.push(`/athlete/${request.follower.id}`)}
                              className="font-bold text-gray-900 hover:text-blue-600 truncate block"
                            >
                              {formatDisplayName(request.follower.first_name, request.follower.middle_name, request.follower.last_name, request.follower.full_name)}
                            </button>
                            {(request.follower.sport || request.follower.school) && (
                              <p className="text-sm text-gray-600 truncate">
                                {request.follower.sport}
                                {request.follower.sport && request.follower.school && ' • '}
                                {request.follower.school}
                              </p>
                            )}
                            {request.message && (
                              <p className="text-sm text-gray-700 mt-2 italic bg-gray-50 p-3 rounded">
                                &quot;{request.message}&quot;
                              </p>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() => handleAcceptRequest(request.id)}
                                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => handleRejectRequest(request.id)}
                                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 transition-colors"
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
