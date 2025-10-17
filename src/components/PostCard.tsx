'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import LazyImage from './LazyImage';
import ConfirmModal from './ConfirmModal';
import CommentSection from './CommentSection';
import SharedRoundQuickView from './golf/SharedRoundQuickView';
import SharedRoundFullCard from './golf/SharedRoundFullCard';
import ScoreEntryModal from './golf/ScoreEntryModal';
import { getSportName, getSportIcon, getSportColor } from '@/lib/config/sports-config';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { getHandle } from '@/lib/profile-display';
import type { CompleteGolfScorecard } from '@/types/group-posts';
import type { GolfRound } from '@/types/golf';

interface PostMedia {
  id: string;
  media_url: string;
  media_type: 'image' | 'video';
  display_order: number;
}

interface Profile {
  id: string;
  first_name: string | null;
  middle_name?: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle?: string | null;
}

interface TaggedProfile {
  id: string;
  first_name: string | null;
  middle_name?: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle?: string | null;
}

interface Post {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: Record<string, unknown> | null;
  visibility: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  saves_count?: number;
  profile: Profile;
  media: PostMedia[];
  likes?: { profile_id: string }[];
  saved_posts?: { profile_id: string }[];
  tags?: string[];
  hashtags?: string[];
  golf_round?: GolfRound;
  tagged_profiles?: TaggedProfile[];
  group_scorecard?: CompleteGolfScorecard; // Shared round scorecard
}

interface PostCardProps {
  post: Post;
  currentUserId?: string;
  onLike?: (postId: string) => void;
  onComment?: (postId: string) => void;
  onDelete?: (postId: string) => void;
  onEdit?: (postId: string) => void;
  onCommentCountChange?: (postId: string, newCount: number) => void;
  showActions?: boolean;
}

export default function PostCard({
  post,
  currentUserId,
  onLike,
  onComment,
  onDelete,
  onEdit,
  onCommentCountChange,
  showActions = true
}: PostCardProps) {
  const router = useRouter();
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [isLiked, setIsLiked] = useState(
    post.likes?.some(like => like.profile_id === currentUserId) || false
  );
  const [isSaved, setIsSaved] = useState(
    post.saved_posts?.some(save => save.profile_id === currentUserId) || false
  );
  const [localLikesCount, setLocalLikesCount] = useState(post.likes_count);
  const [localCommentsCount, setLocalCommentsCount] = useState(post.comments_count);
  const [, setLocalSavesCount] = useState(post.saves_count || 0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFullScorecard, setShowFullScorecard] = useState(false);
  const [showScoreEntry, setShowScoreEntry] = useState(false);
  const [scoreEntryParticipantId, setScoreEntryParticipantId] = useState<string | null>(null);

  // Update isLiked state when post.likes array changes
  useEffect(() => {
    setIsLiked(post.likes?.some(like => like.profile_id === currentUserId) || false);
  }, [post.likes, currentUserId]);

  // Update isSaved state when post.saved_posts array changes
  useEffect(() => {
    setIsSaved(post.saved_posts?.some(save => save.profile_id === currentUserId) || false);
  }, [post.saved_posts, currentUserId]);

  // Update local likes count when post prop changes
  useEffect(() => {
    setLocalLikesCount(post.likes_count);
  }, [post.likes_count]);

  // Update local comments count when post prop changes
  useEffect(() => {
    setLocalCommentsCount(post.comments_count);
  }, [post.comments_count]);

  // Update local saves count when post prop changes
  useEffect(() => {
    setLocalSavesCount(post.saves_count || 0);
  }, [post.saves_count]);

  const displayName = formatDisplayName(
    post.profile.first_name,
    null,  // Don't include middle name in display
    post.profile.last_name,
    post.profile.full_name
  );

  const timeAgo = formatDistanceToNow(new Date(post.created_at), { addSuffix: true });

  const SportIcon = post.sport_key ? getSportIcon(post.sport_key) : null;
  const sportColor = post.sport_key ? getSportColor(post.sport_key) : '#6B7280';

  const handleLike = () => {
    if (onLike) {
      // Only optimistically update the heart icon, not the count
      // The count will be updated from the server response via props
      setIsLiked(!isLiked);

      // Call parent handler which will update with actual count from server
      onLike(post.id);
    }
  };

  const handleComment = () => {
    if (onComment) {
      onComment(post.id);
    }
  };

  const handleCommentCountChange = (newCount: number) => {
    setLocalCommentsCount(newCount);
    if (onCommentCountChange) {
      onCommentCountChange(post.id, newCount);
    }
  };

  const handleSave = async () => {
    if (!currentUserId) return;

    // Optimistic update
    setIsSaved(!isSaved);

    try {
      const response = await fetch('/api/posts/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.id })
      });

      const data = await response.json();

      if (!response.ok) {
        // Revert on error
        setIsSaved(isSaved);
        console.error('Failed to save/unsave post:', data.error);
        return;
      }

      // Update counts from server
      setLocalSavesCount(data.savesCount);
      setIsSaved(data.isSaved);
    } catch (error) {
      // Revert on error
      setIsSaved(isSaved);
      console.error('Error saving/unsaving post:', error);
    }
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/athlete/${post.profile.id}?post=${post.id}`;
    const shareText = post.caption ? `${post.caption.substring(0, 100)}${post.caption.length > 100 ? '...' : ''}` : 'Check out this post!';

    // Check if Web Share API is available and can be used
    if (navigator.share && navigator.canShare) {
      try {
        const shareData = {
          title: `Post by ${displayName}`,
          text: shareText,
          url: shareUrl
        };

        // Check if we can share this data
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return;
        }
      } catch (error) {
        // User cancelled or error occurred
        const err = error as Error;
        if (err.name !== 'AbortError') {
          console.error('Error sharing:', error);
          // Fall through to clipboard fallback
        } else {
          // User cancelled, don't show error
          return;
        }
      }
    }

    // Fallback: Copy to clipboard using modern API
    try {
      await navigator.clipboard.writeText(shareUrl);
      showShareSuccess();
      return;
    } catch {
      // Clipboard API blocked, use legacy method
      console.log('Clipboard API blocked, using legacy method');
    }

    // Final fallback: Use legacy execCommand method
    try {
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (successful) {
        showShareSuccess();
      } else {
        throw new Error('Copy command failed');
      }
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      // Show input field for manual copy as last resort
      alert(`Copy this link:\n\n${shareUrl}`);
    }
  };

  const showShareSuccess = () => {
    const button = document.activeElement as HTMLElement;
    if (button) {
      const originalHTML = button.innerHTML;
      button.innerHTML = '<i class="fas fa-check"></i>';
      button.classList.add('text-green-500');
      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.classList.remove('text-green-500');
      }, 2000);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = () => {
    if (onDelete) {
      onDelete(post.id);
    }
    setShowDeleteConfirm(false);
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const isOwner = currentUserId === post.profile.id;

  const nextMedia = () => {
    if (post.media.length > 1) {
      setCurrentMediaIndex((prev) => (prev + 1) % post.media.length);
    }
  };

  const prevMedia = () => {
    if (post.media.length > 1) {
      setCurrentMediaIndex((prev) => (prev - 1 + post.media.length) % post.media.length);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md border-2 border-gray-300 overflow-hidden mb-6">
      {/* Header */}
      <div className="p-base flex items-center justify-between">
        <button
          onClick={() => {
            // Navigate to own profile page if viewing own post, otherwise to athlete's profile
            if (currentUserId === post.profile.id) {
              router.push('/athlete');
            } else {
              router.push(`/athlete/${post.profile.id}`);
            }
          }}
          className="flex items-center gap-4 hover:bg-gray-50 p-1 rounded-lg transition-colors"
        >
          {/* Profile Avatar */}
          {post.profile.avatar_url ? (
            <LazyImage
              src={post.profile.avatar_url}
              alt={`${displayName} avatar`}
              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              width={40}
              height={40}
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-medium text-gray-600">
                {getInitials(displayName)}
              </span>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-900 text-base hover:text-blue-600 transition-colors">{displayName}</h3>
                {getHandle(post.profile) && (
                  <span className="text-sm text-gray-900 font-medium">{getHandle(post.profile)}</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-700 font-medium">{timeAgo}</span>
                {post.sport_key && (
                  <>
                    <span className="text-sm text-gray-700 font-medium">•</span>
                    <div className="flex items-center gap-1">
                      {SportIcon && <SportIcon size={14} style={{ color: sportColor }} />}
                      <span className="text-sm text-gray-700 font-semibold">{getSportName(post.sport_key)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </button>

        <div className="flex items-center gap-2">
          {/* Privacy indicator */}
          {post.visibility === 'private' && (
            <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
              Private
            </div>
          )}

          {/* Edit and Delete buttons - only show for post owner */}
          {isOwner && (
            <>
              <button
                onClick={() => onEdit?.(post.id)}
                className="text-gray-800 hover:text-blue-600 transition-colors p-2 rounded-full hover:bg-blue-50"
                title="Edit post"
              >
                <i className="fas fa-edit text-sm"></i>
              </button>
              <button
                onClick={handleDeleteClick}
                className="text-gray-800 hover:text-red-600 transition-colors p-2 rounded-full hover:bg-red-50"
                title="Delete post"
              >
                <i className="fas fa-trash text-sm"></i>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Media */}
      {post.media && post.media.length > 0 && (
        <div className="relative bg-black">
          <div className="relative w-full flex items-center justify-center">
            {post.media[currentMediaIndex].media_type === 'image' ? (
              <LazyImage
                src={post.media[currentMediaIndex].media_url}
                alt="Post media"
                className="w-full h-auto object-cover mx-auto"
                width={600}
                height={600}
              />
            ) : (
              <video
                src={post.media[currentMediaIndex].media_url}
                className="w-full h-auto mx-auto"
                style={{ maxHeight: '500px' }}
                controls
              />
            )}
          </div>

          {/* Media Navigation */}
          {post.media.length > 1 && (
            <>
              <button
                onClick={prevMedia}
                className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-opacity-70"
              >
                <i className="fas fa-chevron-left text-sm"></i>
              </button>
              <button
                onClick={nextMedia}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-opacity-70"
              >
                <i className="fas fa-chevron-right text-sm"></i>
              </button>
              
              {/* Media indicators */}
              <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-1">
                {post.media.map((_, index) => (
                  <div
                    key={index}
                    className={`w-2 h-2 rounded-full ${
                      index === currentMediaIndex ? 'bg-white' : 'bg-white bg-opacity-50'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      {showActions && (
        <div className="px-base py-micro border-b border-gray-100">
          <div className="flex items-center gap-base">
            <button
              onClick={handleLike}
              className={`flex items-center gap-2 text-base font-bold transition-colors ${
                isLiked ? 'text-red-600' : 'text-gray-800 hover:text-red-600'
              }`}
            >
              <i className={`${isLiked ? 'fas' : 'far'} fa-heart text-lg`}></i>
              <span>{localLikesCount}</span>
            </button>

            <button
              onClick={handleComment}
              className="flex items-center gap-2 text-base font-bold text-gray-800 hover:text-blue-600 transition-colors"
            >
              <i className="far fa-comment text-lg"></i>
              <span>{localCommentsCount}</span>
            </button>

            <button
              onClick={handleShare}
              className="flex items-center gap-2 text-base font-bold text-gray-800 hover:text-green-600 transition-colors"
              title="Share post"
            >
              <i className="far fa-share-square text-lg"></i>
            </button>

            <button
              onClick={handleSave}
              className={`flex items-center gap-2 text-base font-bold transition-colors ml-auto ${
                isSaved ? 'text-yellow-600' : 'text-gray-800 hover:text-yellow-600'
              }`}
              title={isSaved ? 'Unsave post' : 'Save post'}
            >
              <i className={`${isSaved ? 'fas' : 'far'} fa-bookmark text-lg`}></i>
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="px-6 py-4">
        {/* Caption */}
        {post.caption && (
          <p className="text-gray-900 text-base font-medium leading-relaxed mb-3">{post.caption}</p>
        )}

        {/* Hashtags */}
        {post.hashtags && post.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {post.hashtags.map((hashtag, index) => (
              <span
                key={index}
                className="text-blue-600 hover:text-blue-700 cursor-pointer text-base font-bold"
              >
                {hashtag}
              </span>
            ))}
          </div>
        )}

        {/* Tags - Display tagged users/organizations */}
        {post.tagged_profiles && post.tagged_profiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-sm text-gray-600">with</span>
            {post.tagged_profiles.map((taggedProfile) => {
              const taggedDisplayName = formatDisplayName(
                taggedProfile.first_name,
                null,
                taggedProfile.last_name,
                taggedProfile.full_name
              );
              const taggedHandle = getHandle(taggedProfile);

              return (
                <button
                  key={taggedProfile.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Navigate to own profile if clicking own tag
                    if (currentUserId === taggedProfile.id) {
                      router.push('/athlete');
                    } else {
                      router.push(`/athlete/${taggedProfile.id}`);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm rounded-full font-semibold border border-blue-200 transition-colors"
                >
                  {taggedProfile.avatar_url ? (
                    <LazyImage
                      src={taggedProfile.avatar_url}
                      alt={taggedDisplayName}
                      className="w-4 h-4 rounded-full object-cover"
                      width={16}
                      height={16}
                    />
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-blue-200 flex items-center justify-center">
                      <span className="text-[8px] font-medium text-blue-700">
                        {getInitials(taggedDisplayName)}
                      </span>
                    </div>
                  )}
                  <span>{taggedHandle || taggedDisplayName}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Golf Round Data - Compact View */}
        {post.sport_key === 'golf' && post.golf_round && (
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 mt-2 border border-green-200">
            {/* Compact Header with Score */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <i className="fas fa-golf-ball text-green-600 text-base"></i>
                  <span className="font-bold text-green-900 text-base">{post.golf_round.course}</span>
                  {/* Round Type Badge - Indoor or Outdoor */}
                  {post.golf_round.round_type === 'indoor' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full">
                      <i className="fas fa-warehouse text-[10px]"></i>
                      INDOOR
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-600 text-white text-xs font-bold rounded-full">
                      <i className="fas fa-tree text-[10px]"></i>
                      OUTDOOR
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-green-800 font-semibold">
                  {post.golf_round.date && (
                    <span>{new Date(post.golf_round.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  )}
                  {post.golf_round.tee && <span>• {post.golf_round.tee.charAt(0).toUpperCase() + post.golf_round.tee.slice(1)} Tees</span>}
                  {post.golf_round.holes && <span>• {post.golf_round.holes} Holes</span>}
                </div>
              </div>

              {/* Large Score Badge */}
              {post.golf_round.gross_score !== null && post.golf_round.gross_score !== undefined && (() => {
                // Calculate actual par from recorded holes
                const actualPar = post.golf_round.golf_holes?.reduce((sum: number, hole) => sum + (hole.par || 0), 0) || 0;
                const holesPlayed = post.golf_round.golf_holes?.length || 0;
                const toPar = actualPar > 0 ? post.golf_round.gross_score - actualPar : null;

                return (
                  <div className="text-right ml-3">
                    <div className="bg-white rounded-lg px-4 py-2 shadow-md border-2 border-green-300">
                      <div className="text-3xl font-black text-green-900 leading-none">{post.golf_round.gross_score}</div>
                      {toPar !== null && (
                        <div className={`text-sm font-bold ${toPar < 0 ? 'text-blue-600' : 'text-red-600'}`}>
                          {toPar >= 0 ? '+' : ''}{toPar}
                        </div>
                      )}
                      {holesPlayed > 0 && holesPlayed < 18 && (
                        <div className="text-[10px] text-green-700 font-medium mt-0.5">
                          Through {holesPlayed}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Inline Stats Bar */}
            {(post.golf_round.total_putts || post.golf_round.fir_percentage !== null || post.golf_round.gir_percentage !== null) && (
              <div className="flex items-center gap-5 text-sm bg-white/60 rounded px-3 py-2 mb-2">
                {post.golf_round.total_putts && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-green-800 font-semibold">Putts:</span>
                    <span className="font-bold text-green-900">{post.golf_round.total_putts}</span>
                  </div>
                )}
                {post.golf_round.fir_percentage !== null && post.golf_round.fir_percentage !== undefined && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-green-800 font-semibold">FIR:</span>
                    <span className="font-bold text-green-900">{Math.round(post.golf_round.fir_percentage)}%</span>
                  </div>
                )}
                {post.golf_round.gir_percentage !== null && post.golf_round.gir_percentage !== undefined && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-green-800 font-semibold">GIR:</span>
                    <span className="font-bold text-green-900">{Math.round(post.golf_round.gir_percentage)}%</span>
                  </div>
                )}
              </div>
            )}

            {/* Additional Round Details - Weather, Conditions, Rating */}
            {(post.golf_round.weather || post.golf_round.temperature || post.golf_round.wind || post.golf_round.course_rating || post.golf_round.slope_rating) && (
              <div className="flex flex-wrap items-center gap-4 text-xs bg-white/40 rounded px-3 py-1.5 mb-2">
                {post.golf_round.weather && (
                  <div className="flex items-center gap-1.5">
                    <i className="fas fa-cloud-sun text-green-700"></i>
                    <span className="font-semibold text-green-900">{post.golf_round.weather}</span>
                  </div>
                )}
                {post.golf_round.temperature && (
                  <div className="flex items-center gap-1.5">
                    <i className="fas fa-thermometer-half text-green-700"></i>
                    <span className="font-semibold text-green-900">{post.golf_round.temperature}°F</span>
                  </div>
                )}
                {post.golf_round.wind && (
                  <div className="flex items-center gap-1.5">
                    <i className="fas fa-wind text-green-700"></i>
                    <span className="font-semibold text-green-900">{post.golf_round.wind}</span>
                  </div>
                )}
                {post.golf_round.course_rating && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-green-800 font-medium">Rating:</span>
                    <span className="font-bold text-green-900">{post.golf_round.course_rating}</span>
                  </div>
                )}
                {post.golf_round.slope_rating && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-green-800 font-medium">Slope:</span>
                    <span className="font-bold text-green-900">{post.golf_round.slope_rating}</span>
                  </div>
                )}
              </div>
            )}

            {/* Collapsible Traditional Scorecard */}
            {post.golf_round.golf_holes && post.golf_round.golf_holes.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-green-700 hover:text-green-900 flex items-center gap-1 py-1">
                  <i className="fas fa-chevron-right group-open:rotate-90 transition-transform text-[10px]"></i>
                  View Scorecard ({post.golf_round.golf_holes.length} holes)
                </summary>
                <div className="mt-3">
                  {/* Traditional Scorecard Layout */}
                  <div className="bg-white rounded border border-gray-300 overflow-hidden">
                    {/* Front 9 */}
                    {post.golf_round.golf_holes.filter((h) => h.hole_number <= 9).length > 0 && (
                      <div className="border-b-2 border-gray-400">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-green-100 border-b border-gray-300">
                              <th className="text-left py-1.5 px-2 font-bold text-green-900">HOLE</th>
                              {post.golf_round.golf_holes
                                .filter((h) => h.hole_number <= 9)
                                .map((hole) => (
                                  <th key={hole.hole_number} className="text-center py-1.5 px-1 font-black text-green-900">
                                    {hole.hole_number}
                                  </th>
                                ))}
                              <th className="text-center py-1.5 px-2 font-black text-green-900 bg-green-200">OUT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Yardage Row */}
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <td className="py-1.5 px-2 font-bold text-gray-800">YDS</td>
                              {post.golf_round.golf_holes
                                .filter((h) => h.hole_number <= 9)
                                .map((hole) => (
                                  <td key={hole.hole_number} className="text-center py-1.5 px-1 font-semibold text-gray-700">
                                    {hole.distance_yards || '-'}
                                  </td>
                                ))}
                              <td className="text-center py-1.5 px-2 font-bold text-gray-800 bg-gray-100">
                                {post.golf_round.golf_holes
                                  .filter((h) => h.hole_number <= 9)
                                  .reduce((sum: number, h) => sum + (h.distance_yards || 0), 0) || '-'}
                              </td>
                            </tr>
                            {/* Par Row */}
                            <tr className="border-b border-gray-300 bg-yellow-50">
                              <td className="py-1.5 px-2 font-bold text-gray-900">PAR</td>
                              {post.golf_round.golf_holes
                                .filter((h) => h.hole_number <= 9)
                                .map((hole) => (
                                  <td key={hole.hole_number} className="text-center py-1.5 px-1 font-bold text-gray-900">
                                    {hole.par}
                                  </td>
                                ))}
                              <td className="text-center py-1.5 px-2 font-black text-gray-900 bg-yellow-100">
                                {post.golf_round.golf_holes
                                  .filter((h) => h.hole_number <= 9)
                                  .reduce((sum: number, h) => sum + (h.par || 0), 0)}
                              </td>
                            </tr>
                            {/* Score Row */}
                            <tr className="border-b-2 border-gray-400">
                              <td className="py-2 px-2 font-black text-gray-900">SCORE</td>
                              {post.golf_round.golf_holes
                                .filter((h) => h.hole_number <= 9)
                                .map((hole) => {
                                  const diff = (hole.strokes ?? 0) - hole.par;
                                  const bgColor = 'bg-white';
                                  let textColor = 'text-gray-900';
                                  let border = '';

                                  if (diff === -2) { // Eagle
                                    border = 'ring-2 ring-blue-500 ring-inset';
                                    textColor = 'text-blue-600 font-black';
                                  } else if (diff === -1) { // Birdie
                                    border = 'ring-1 ring-blue-400 ring-inset';
                                    textColor = 'text-blue-600 font-bold';
                                  } else if (diff === 1) { // Bogey
                                    border = 'border border-red-400';
                                    textColor = 'text-red-600 font-semibold';
                                  } else if (diff >= 2) { // Double+
                                    border = 'ring-2 ring-red-500 ring-inset';
                                    textColor = 'text-red-600 font-bold';
                                  } else { // Par
                                    textColor = 'text-gray-900 font-semibold';
                                  }

                                  return (
                                    <td key={hole.hole_number} className="text-center py-1.5 px-1">
                                      <div className={`${bgColor} ${textColor} ${border} rounded mx-auto w-7 h-7 flex items-center justify-center text-sm`}>
                                        {hole.strokes}
                                      </div>
                                    </td>
                                  );
                                })}
                              <td className="text-center py-2 px-2 bg-blue-50">
                                <span className="font-black text-blue-900 text-base">
                                  {post.golf_round.golf_holes
                                    .filter((h) => h.hole_number <= 9)
                                    .reduce((sum: number, h) => sum + (h.strokes || 0), 0)}
                                </span>
                              </td>
                            </tr>
                            {/* Putts Row */}
                            <tr className="bg-gray-50">
                              <td className="py-1.5 px-2 text-xs font-semibold text-gray-700">Putts</td>
                              {post.golf_round.golf_holes
                                .filter((h) => h.hole_number <= 9)
                                .map((hole) => (
                                  <td key={hole.hole_number} className="text-center py-1.5 px-1 text-xs font-medium text-gray-700">
                                    {hole.putts || '-'}
                                  </td>
                                ))}
                              <td className="text-center py-1.5 px-2 font-bold text-gray-800 bg-gray-100">
                                {post.golf_round.golf_holes
                                  .filter((h) => h.hole_number <= 9)
                                  .reduce((sum: number, h) => sum + (h.putts || 0), 0) || '-'}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Back 9 */}
                    {post.golf_round.golf_holes.filter((h) => h.hole_number > 9).length > 0 && (
                      <div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-green-100 border-b border-gray-300">
                              <th className="text-left py-1.5 px-2 font-bold text-green-900">HOLE</th>
                              {post.golf_round.golf_holes
                                .filter((h) => h.hole_number > 9)
                                .map((hole) => (
                                  <th key={hole.hole_number} className="text-center py-1.5 px-1 font-black text-green-900">
                                    {hole.hole_number}
                                  </th>
                                ))}
                              <th className="text-center py-1.5 px-2 font-black text-green-900 bg-green-200">IN</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Yardage */}
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <td className="py-1.5 px-2 font-bold text-gray-800">YDS</td>
                              {post.golf_round.golf_holes
                                .filter((h) => h.hole_number > 9)
                                .map((hole) => (
                                  <td key={hole.hole_number} className="text-center py-1.5 px-1 font-semibold text-gray-700">
                                    {hole.distance_yards || '-'}
                                  </td>
                                ))}
                              <td className="text-center py-1.5 px-2 font-bold text-gray-800 bg-gray-100">
                                {post.golf_round.golf_holes
                                  .filter((h) => h.hole_number > 9)
                                  .reduce((sum: number, h) => sum + (h.distance_yards || 0), 0) || '-'}
                              </td>
                            </tr>
                            {/* Par */}
                            <tr className="border-b border-gray-300 bg-yellow-50">
                              <td className="py-1.5 px-2 font-bold text-gray-900">PAR</td>
                              {post.golf_round.golf_holes
                                .filter((h) => h.hole_number > 9)
                                .map((hole) => (
                                  <td key={hole.hole_number} className="text-center py-1.5 px-1 font-bold text-gray-900">
                                    {hole.par}
                                  </td>
                                ))}
                              <td className="text-center py-1.5 px-2 font-black text-gray-900 bg-yellow-100">
                                {post.golf_round.golf_holes
                                  .filter((h) => h.hole_number > 9)
                                  .reduce((sum: number, h) => sum + (h.par || 0), 0)}
                              </td>
                            </tr>
                            {/* Score */}
                            <tr className="border-b border-gray-300">
                              <td className="py-2 px-2 font-black text-gray-900">SCORE</td>
                              {post.golf_round.golf_holes
                                .filter((h) => h.hole_number > 9)
                                .map((hole) => {
                                  const diff = (hole.strokes ?? 0) - hole.par;
                                  let textColor = 'text-gray-900';
                                  let border = '';

                                  if (diff === -2) {
                                    border = 'ring-2 ring-blue-500 ring-inset';
                                    textColor = 'text-blue-600 font-black';
                                  } else if (diff === -1) {
                                    border = 'ring-1 ring-blue-400 ring-inset';
                                    textColor = 'text-blue-600 font-bold';
                                  } else if (diff === 1) {
                                    border = 'border border-red-400';
                                    textColor = 'text-red-600 font-semibold';
                                  } else if (diff >= 2) {
                                    border = 'ring-2 ring-red-500 ring-inset';
                                    textColor = 'text-red-600 font-bold';
                                  } else {
                                    textColor = 'text-gray-900 font-semibold';
                                  }

                                  return (
                                    <td key={hole.hole_number} className="text-center py-1.5 px-1">
                                      <div className={`bg-white ${textColor} ${border} rounded mx-auto w-7 h-7 flex items-center justify-center text-sm`}>
                                        {hole.strokes}
                                      </div>
                                    </td>
                                  );
                                })}
                              <td className="text-center py-2 px-2 bg-blue-50">
                                <span className="font-black text-blue-900 text-base">
                                  {post.golf_round.golf_holes
                                    .filter((h) => h.hole_number > 9)
                                    .reduce((sum: number, h) => sum + (h.strokes || 0), 0)}
                                </span>
                              </td>
                            </tr>
                            {/* Putts */}
                            <tr className="bg-gray-50">
                              <td className="py-1.5 px-2 text-xs font-semibold text-gray-700">Putts</td>
                              {post.golf_round.golf_holes
                                .filter((h) => h.hole_number > 9)
                                .map((hole) => (
                                  <td key={hole.hole_number} className="text-center py-1.5 px-1 text-xs font-medium text-gray-700">
                                    {hole.putts || '-'}
                                  </td>
                                ))}
                              <td className="text-center py-1.5 px-2 font-bold text-gray-800 bg-gray-100">
                                {post.golf_round.golf_holes
                                  .filter((h) => h.hole_number > 9)
                                  .reduce((sum: number, h) => sum + (h.putts || 0), 0) || '-'}
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        {/* Total Score Row */}
                        <div className="bg-blue-100 border-t-2 border-blue-300 px-2 py-1.5 flex justify-between items-center">
                          <span className="text-xs font-bold text-blue-900">TOTAL SCORE</span>
                          <span className="text-lg font-black text-blue-900">
                            {post.golf_round.gross_score}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Legend */}
                  <div className="mt-2 flex items-center gap-3 text-[9px] text-gray-600">
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded ring-2 ring-blue-500 ring-inset"></div>
                      <span>Eagle</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded ring-1 ring-blue-400 ring-inset"></div>
                      <span>Birdie</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded border border-red-400"></div>
                      <span>Bogey</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded ring-2 ring-red-500 ring-inset"></div>
                      <span>Double+</span>
                    </div>
                  </div>
                </div>
              </details>
            )}
          </div>
        )}

        {/* Shared Round Scorecard - Multi-Player */}
        {post.group_scorecard && (
          <SharedRoundQuickView
            scorecard={post.group_scorecard}
            onExpand={() => setShowFullScorecard(true)}
            currentUserId={currentUserId}
          />
        )}

        {/* Sport Stats */}
        {post.stats_data && post.sport_key === 'golf' && (
          <div className="bg-gray-50 rounded-lg p-micro mt-micro">
            <div className="text-xs text-gray-900 mb-1 font-bold">Golf Stats</div>
            {post.stats_data.type === 'round_recap' && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="font-medium">Score:</span> {String(post.stats_data.grossScore ?? '')}
                </div>
                {Boolean(post.stats_data.course) && (
                  <div>
                    <span className="font-medium">Course:</span> {String(post.stats_data.course)}
                  </div>
                )}
                {Boolean(post.stats_data.firPercentage) && (
                  <div>
                    <span className="font-medium">FIR:</span> {Math.round(Number(post.stats_data.firPercentage))}%
                  </div>
                )}
                {Boolean(post.stats_data.totalPutts) && (
                  <div>
                    <span className="font-medium">Putts:</span> {String(post.stats_data.totalPutts)}
                  </div>
                )}
              </div>
            )}
            {post.stats_data.type === 'hole_highlight' && (
              <div className="text-xs">
                <span className="font-medium">Hole {String(post.stats_data.holeNumber ?? '')}:</span>
                {' '}{String(post.stats_data.score ?? '')} on Par {String(post.stats_data.par ?? '')}
                {Boolean(post.stats_data.club) && (
                  <span> • {String(post.stats_data.club)}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Comments Section */}
      <CommentSection
        postId={post.id}
        initialCommentsCount={post.comments_count}
        onCommentCountChange={handleCommentCountChange}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Post"
        message="Are you sure you want to permanently delete this post? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />

      {/* Shared Round Full Scorecard Modal */}
      {showFullScorecard && post.group_scorecard && (
        <SharedRoundFullCard
          scorecard={post.group_scorecard}
          currentUserId={currentUserId}
          onClose={() => setShowFullScorecard(false)}
          onAddScores={(participantId) => {
            setScoreEntryParticipantId(participantId);
            setShowFullScorecard(false);
            setShowScoreEntry(true);
          }}
        />
      )}

      {/* Score Entry Modal */}
      {showScoreEntry && post.group_scorecard && scoreEntryParticipantId && (
        <ScoreEntryModal
          groupPostId={post.group_scorecard.group_post.id}
          participantId={scoreEntryParticipantId}
          holesPlayed={post.group_scorecard.golf_data.holes_played}
          existingScores={
            post.group_scorecard.participants
              .find(p => p.participant.id === scoreEntryParticipantId)
              ?.scores.hole_scores || []
          }
          onSave={async (scores) => {
            try {
              const response = await fetch(`/api/golf/scorecards/${post.group_scorecard!.group_post.id}/scores`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scores })
              });

              if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to save scores');
              }

              // Reload the page to show updated scores
              window.location.reload();
            } catch (error: unknown) {
              console.error('Error saving scores:', error);
              throw error;
            }
          }}
          onClose={() => {
            setShowScoreEntry(false);
            setScoreEntryParticipantId(null);
            setShowFullScorecard(true);
          }}
        />
      )}
    </div>
  );
}