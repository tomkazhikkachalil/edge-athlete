'use client';

import { useState, useEffect, useCallback } from 'react';
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

  const loadFollowStats = useCallback(async () => {
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
        return data as { followersCount: number; isFollowing: boolean; followStatus: string | null };
      } else {
        // If the table doesn't exist yet, just show default values
        setFollowersCount(0);
        setIsFollowing(false);
        setFollowStatus(null);
      }
    } catch (e) {
      console.error('Failed to load follow stats (FollowButton):', e);
      setFollowersCount(0);
      setIsFollowing(false);
      setFollowStatus(null);
    } finally {
      setStatsLoading(false);
    }
  }, [profileId, currentUserId]);

  // Load follow stats on component mount
  useEffect(() => {
    if (profileId && currentUserId) {
      loadFollowStats();
    }
  }, [profileId, currentUserId, loadFollowStats]);

  const handleFollowClick = () => {
    if (!currentUserId) {
      showError('Authentication Required', 'Please log in to become a fan');
      return;
    }

    if (profileId === currentUserId) {
      showError('Error', 'You cannot be a fan of yourself');
      return;
    }

    // If already following or pending, unfollow/cancel directly
    if (isFollowing) {
      handleFollow();
    } else {
      // Show message modal for new follow requests
      setShowMessageModal(true);
    }
  };

  const handleFollow = async () => {
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

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update follow status');
      }

      const data = await response.json();

      const newFollowingStatus = data.action === 'followed';

      setIsFollowing(newFollowingStatus);
      setFollowMessage(''); // Reset message

      // Reload stats from server to ensure accurate state, and report THAT
      // count to the parent. Locally computed ±1 was wrong for private
      // profiles: a pending fan request incremented the visible Fans count,
      // and cancelling one could render -1 (server only counts accepted).
      const fresh = await loadFollowStats();

      // Notify parent component with server-accurate values
      onFollowChange?.(newFollowingStatus, fresh?.followersCount ?? followersCount);

      if (newFollowingStatus) {
        const message = data.isPending
          ? 'Fan request sent! They will be notified.'
          : 'You are now a fan of this athlete!';
        showSuccess('Success', message);
        // (No redirect — the hard-coded push to /feed yanked users out of
        // whatever page or modal they were following from.)
      } else {
        showSuccess('Removed', 'You are no longer a fan of this athlete');
      }

    } catch (err) {
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
          <i className="fas fa-heart mr-1"></i>
          Fan
        </>
      );
    }

    return (
      <>
        <i className="fas fa-heart mr-1"></i>
        Become a Fan
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
                : 'bg-violet-600 text-white hover:bg-violet-700'
            }
            ${sizeClasses[size]}
            ${className}
          `}
        >
          {getButtonContent()}
        </button>

        {showCount && (
          <span className="text-sm text-gray-600">
            {followersCount} fan{followersCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Fan Request Modal */}
      {showMessageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Become a Fan</h3>
            <p className="text-sm text-gray-600 mb-4">
              Add an optional message to introduce yourself (optional)
            </p>

            <textarea
              value={followMessage}
              onChange={(e) => setFollowMessage(e.target.value)}
              placeholder="Hi! I'd love to connect..."
              maxLength={200}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none text-black"
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
                className="flex-1 px-4 py-2 bg-violet-600 text-white font-medium rounded-lg hover:bg-violet-700 transition-colors"
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