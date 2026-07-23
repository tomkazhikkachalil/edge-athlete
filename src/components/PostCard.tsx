'use client';

import { useState, useEffect, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import LazyImage from './LazyImage';
import ConfirmModal from './ConfirmModal';
import CommentSection from './CommentSection';
import SharePostModal from './SharePostModal';
import SportPostBody from './SportPostBody';
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
  const [commentSectionOpen, setCommentSectionOpen] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const commentSectionRef = useRef<HTMLDivElement>(null);

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
    setCommentSectionOpen(true);
    requestAnimationFrame(() => {
      commentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
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
        return;
      }

      // Update counts from server
      setLocalSavesCount(data.savesCount);
      setIsSaved(data.isSaved);
    } catch (e) {
      console.error('Failed to toggle saved post:', e);
      // Revert on error
      setIsSaved(isSaved);
    }
  };

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/athlete/${post.profile.id}?post=${post.id}`
    : '';

  const handleShare = () => {
    setShowShareModal(true);
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

  // Touch swipe for the media carousel (mobile has no hover/arrow affordance)
  const touchStartX = useRef<number | null>(null);
  const handleMediaTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleMediaTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(deltaX) < 50) return; // ignore taps/small drags
    if (deltaX < 0) nextMedia();
    else prevMedia();
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
                className="text-gray-800 hover:text-blue-600 transition-colors p-2 min-w-[44px] min-h-[44px] rounded-full hover:bg-blue-50 flex items-center justify-center"
                title="Edit post"
              >
                <i className="fas fa-edit text-sm"></i>
              </button>
              <button
                onClick={handleDeleteClick}
                className="text-gray-800 hover:text-red-600 transition-colors p-2 min-w-[44px] min-h-[44px] rounded-full hover:bg-red-50 flex items-center justify-center"
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
        <div
          className="relative bg-gray-100"
          onTouchStart={handleMediaTouchStart}
          onTouchEnd={handleMediaTouchEnd}
        >
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
                className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black/50 text-white rounded-full w-11 h-11 flex items-center justify-center hover:bg-black/70"
                aria-label="Previous image"
              >
                <i className="fas fa-chevron-left text-sm"></i>
              </button>
              <button
                onClick={nextMedia}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black/50 text-white rounded-full w-11 h-11 flex items-center justify-center hover:bg-black/70"
                aria-label="Next image"
              >
                <i className="fas fa-chevron-right text-sm"></i>
              </button>
              
              {/* Media indicators */}
              <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-1">
                {post.media.map((_, index) => (
                  <div
                    key={index}
                    className={`w-2 h-2 rounded-full ${
                      index === currentMediaIndex ? 'bg-white' : 'bg-white/50'
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
              className={`flex items-center gap-2 text-base font-bold transition-colors min-h-[44px] ${
                isLiked ? 'text-red-600' : 'text-gray-800 hover:text-red-600'
              }`}
            >
              <i className={`${isLiked ? 'fas' : 'far'} fa-heart text-lg`}></i>
              <span>{localLikesCount}</span>
            </button>

            <button
              onClick={handleComment}
              className="flex items-center gap-2 text-base font-bold text-gray-800 hover:text-blue-600 transition-colors min-h-[44px]"
            >
              <i className="far fa-comment text-lg"></i>
              <span>{localCommentsCount}</span>
            </button>

            <button
              onClick={handleShare}
              className="flex items-center gap-2 text-base font-bold text-gray-800 hover:text-green-600 transition-colors min-h-[44px]"
              title="Share post"
            >
              <i className="far fa-share-square text-lg"></i>
            </button>

            <button
              onClick={handleSave}
              className={`flex items-center gap-2 text-base font-bold transition-colors ml-auto min-h-[44px] ${
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
          <p className="text-gray-900 text-base font-medium leading-relaxed mb-3 break-words">{post.caption}</p>
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

        {/* Sport-specific post body (golf scorecard, stats) — dispatched by sport_key */}
        <SportPostBody
          sportKey={post.sport_key}
          golfRound={post.golf_round}
          statsData={post.stats_data}
        />

        {/* Shared Round Scorecard - Multi-Player */}
        {post.group_scorecard && (
          <SharedRoundQuickView
            scorecard={post.group_scorecard}
            onExpand={() => setShowFullScorecard(true)}
            currentUserId={currentUserId}
          />
        )}

        {/* Vitals badge — shown on training posts created from a vitals entry */}
        {post.stats_data?.type === 'vitals_entry' && (
          <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 rounded-lg text-sm mb-2 mx-base">
            <i className="fas fa-dumbbell text-violet-500 text-xs"></i>
            <span className="font-semibold text-violet-700">
              {post.stats_data.metric_label as string}
            </span>
            <span className="text-violet-600 font-medium">
              {post.stats_data.value_display as string}
            </span>
          </div>
        )}

      </div>

      {/* Comments Section */}
      <div ref={commentSectionRef}>
        <CommentSection
          postId={post.id}
          postOwnerId={post.profile.id}
          initialCommentsCount={post.comments_count}
          isOpen={commentSectionOpen}
          onCommentCountChange={handleCommentCountChange}
        />
      </div>

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
              // The endpoint's [id] is the PARTICIPANT id, not the group_post id.
              const response = await fetch(`/api/golf/scorecards/${scoreEntryParticipantId}/scores`, {
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
            } catch (err) {
              throw err;
            }
          }}
          onClose={() => {
            setShowScoreEntry(false);
            setScoreEntryParticipantId(null);
            setShowFullScorecard(true);
          }}
        />
      )}

      {/* Share Post Modal */}
      <SharePostModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        postId={post.id}
        postCaption={post.caption}
        postAuthorName={displayName}
        shareUrl={shareUrl}
      />
    </div>
  );
}