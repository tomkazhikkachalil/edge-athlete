'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useToast } from './Toast';

interface FollowButtonProps {
  profileId: string;
  currentUserId?: string; // Optional - will use auth hook if not provided
  onFollowChange?: (isFollowing: boolean, followersCount: number) => void;
  size?: 'sm' | 'md' | 'lg';
  showCount?: boolean;
  className?: string;
}

export default function FollowButton({
  profileId,
  currentUserId: propCurrentUserId,
  onFollowChange,
  size = 'md',
  showCount = false,
  className = ''
}: FollowButtonProps) {
  const router = useRouter();
  const { user } = useAuth();
  const currentUserId = propCurrentUserId || user?.id;

  const [isFollowing, setIsFollowing] = useState(false);
  const [followStatus, setFollowStatus] = useState<string | null>(null);
  const [followersCount, setFollowersCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [followMessage, setFollowMessage] = useState('');
  const { showError, showSuccess } = useToast();

  // Size classes
  const sizeClasses = {
    sm: 'px-3 py-1 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base'
  };

  // Load follow stats on component mount
  useEffect(() => {
    if (profileId && currentUserId) {
      loadFollowStats();
    }
  }, [profileId, currentUserId]);

  const loadFollowStats = async () => {
    try {
      setStatsLoading(true);
      const params = new URLSearchParams({ profileId });
      if (currentUserId) {
        params.append('currentUserId', currentUserId);
      }

      const response = await fetch(`/api/follow/stats?${params}`);

      if (response.ok) {
        const data = await response.json();
        setFollowersCount(data.followersCount);
        setIsFollowing(data.isFollowing);
        setFollowStatus(data.followStatus);
      } else {
        // If the table doesn't exist yet, just show default values
        setFollowersCount(0);
        setIsFollowing(false);
        setFollowStatus(null);
      }
    } catch {
      // Silently handle errors for now (table might not exist yet)
      setFollowersCount(0);
      setIsFollowing(false);
      setFollowStatus(null);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleFollowClick = () => {
    console.log('[FOLLOW BUTTON] Button clicked!', { currentUserId, profileId, isFollowing, followStatus });

    if (!currentUserId) {
      console.log('[FOLLOW BUTTON] No currentUserId, showing error');
      showError('Authentication Required', 'Please log in to follow athletes');
      return;
    }

    if (profileId === currentUserId) {
      console.log('[FOLLOW BUTTON] Cannot follow self');
      showError('Error', 'You cannot follow yourself');
      return;
    }

    // If already following or pending, unfollow/cancel directly
    if (isFollowing) {
      console.log('[FOLLOW BUTTON] Already following/pending, unfollowing/canceling');
      handleFollow();
    } else {
      // Show message modal for new follow requests
      console.log('[FOLLOW BUTTON] Showing message modal');
      setShowMessageModal(true);
    }
  };

  const handleFollow = async () => {
    console.log('[FOLLOW BUTTON] Starting follow action', { currentUserId, profileId, followMessage });
    setLoading(true);
    setShowMessageModal(false);

    try {
      const response = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          followerId: currentUserId,
          followingId: profileId,
          message: followMessage || undefined
        })
      });

      console.log('[FOLLOW BUTTON] API response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[FOLLOW BUTTON] API error:', errorData);
        throw new Error(errorData.error || 'Failed to update follow status');
      }

      const data = await response.json();
      console.log('[FOLLOW BUTTON] API response data:', data);

      const newFollowingStatus = data.action === 'followed';
      const newFollowersCount = newFollowingStatus ? followersCount + 1 : followersCount - 1;

      setIsFollowing(newFollowingStatus);
      setFollowersCount(newFollowersCount);
      setFollowMessage(''); // Reset message

      // Reload stats from server to ensure accurate state
      // This is crucial when a follow request is rejected - we need fresh data
      await loadFollowStats();

      // Notify parent component
      onFollowChange?.(newFollowingStatus, newFollowersCount);

      if (newFollowingStatus) {
        const message = data.isPending
          ? 'Follow request sent! They will be notified.'
          : 'You are now following this athlete!';
        showSuccess('Success', message);

        // Redirect to feed after successful follow
        setTimeout(() => {
          router.push('/feed');
        }, 500);
      } else {
        showSuccess('Unfollowed', 'You are no longer following this athlete');
      }

    } catch (err) {
      console.error('[FOLLOW BUTTON] Error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to update follow status';
      showError('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Don't show follow button for own profile
  if (profileId === currentUserId) {
    return null;
  }

  // Loading state
  if (statsLoading) {
    return (
      <div className={`bg-gray-200 rounded-full animate-pulse ${sizeClasses[size]} ${className}`}>
        <div className="bg-gray-300 h-4 rounded"></div>
      </div>
    );
  }

  // Button text based on status
  const getButtonContent = () => {
    if (loading) {
      return <i className="fas fa-spinner fa-spin"></i>;
    }

    if (followStatus === 'pending') {
      return (
        <>
          <i className="fas fa-clock mr-1"></i>
          Requested
        </>
      );
    }

    if (isFollowing) {
      return (
        <>
          <i className="fas fa-check mr-1"></i>
          Following
        </>
      );
    }

    return (
      <>
        <i className="fas fa-plus mr-1"></i>
        Follow
      </>
    );
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={handleFollowClick}
          disabled={loading}
          className={`
            font-medium rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed
            ${followStatus === 'pending'
              ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
              : isFollowing
                ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }
            ${sizeClasses[size]}
            ${className}
          `}
        >
          {getButtonContent()}
        </button>

        {showCount && (
          <span className="text-sm text-gray-600">
            {followersCount} follower{followersCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Follow Message Modal */}
      {showMessageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Send Follow Request</h3>
            <p className="text-sm text-gray-600 mb-4">
              Add an optional message to introduce yourself (optional)
            </p>

            <textarea
              value={followMessage}
              onChange={(e) => setFollowMessage(e.target.value)}
              placeholder="Hi! I'd love to connect..."
              maxLength={200}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-black"
            />

            <div className="text-xs text-gray-500 mt-1 mb-4">
              {followMessage.length}/200 characters
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowMessageModal(false);
                  setFollowMessage('');
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFollow}
                className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}