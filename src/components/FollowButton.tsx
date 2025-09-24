'use client';

import { useState, useEffect } from 'react';
import { useToast } from './Toast';

interface FollowButtonProps {
  profileId: string;
  currentUserId?: string;
  onFollowChange?: (isFollowing: boolean, followersCount: number) => void;
  size?: 'sm' | 'md' | 'lg';
  showCount?: boolean;
  className?: string;
}

export default function FollowButton({
  profileId,
  currentUserId,
  onFollowChange,
  size = 'md',
  showCount = false,
  className = ''
}: FollowButtonProps) {
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const { showError, showSuccess } = useToast();

  // Size classes
  const sizeClasses = {
    sm: 'px-3 py-1 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base'
  };

  // Load follow stats on component mount
  useEffect(() => {
    if (profileId) {
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
      } else {
        // If the table doesn't exist yet, just show default values
        setFollowersCount(0);
        setIsFollowing(false);
      }
    } catch (err) {
      // Silently handle errors for now (table might not exist yet)
      setFollowersCount(0);
      setIsFollowing(false);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleFollow = async () => {
    if (!currentUserId) {
      showError('Authentication Required', 'Please log in to follow athletes');
      return;
    }

    if (profileId === currentUserId) {
      showError('Error', 'You cannot follow yourself');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          followerId: currentUserId, 
          followingId: profileId 
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update follow status');
      }

      const data = await response.json();
      const newFollowingStatus = data.action === 'followed';
      const newFollowersCount = newFollowingStatus ? followersCount + 1 : followersCount - 1;
      
      setIsFollowing(newFollowingStatus);
      setFollowersCount(newFollowersCount);
      
      // Notify parent component
      onFollowChange?.(newFollowingStatus, newFollowersCount);
      
      showSuccess(
        newFollowingStatus ? 'Followed' : 'Unfollowed', 
        newFollowingStatus ? 'You are now following this athlete' : 'You are no longer following this athlete'
      );
      
    } catch (err) {
      showError('Error', 'Failed to update follow status. The follows table may need to be created.');
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

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleFollow}
        disabled={loading || !currentUserId}
        className={`
          font-medium rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed
          ${isFollowing 
            ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' 
            : 'bg-blue-600 text-white hover:bg-blue-700'
          }
          ${sizeClasses[size]}
          ${className}
        `}
      >
        {loading ? (
          <i className="fas fa-spinner fa-spin"></i>
        ) : isFollowing ? (
          <>
            <i className="fas fa-check mr-1"></i>
            Following
          </>
        ) : (
          <>
            <i className="fas fa-plus mr-1"></i>
            Follow
          </>
        )}
      </button>
      
      {showCount && (
        <span className="text-sm text-gray-600">
          {followersCount} follower{followersCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}