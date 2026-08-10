'use client';

import { useState, useRef, memo, createElement } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useSharedRound } from '@/hooks/useSharedRound';
import LazyImage from './LazyImage';
import MediaTile from './media/MediaTile';
import MediaStatStrip from './media/MediaStatStrip';
import { buildPostHeadline } from '@/lib/sports/post-headline';
import ConfirmModal from './ConfirmModal';
import CommentSection from './CommentSection';
import SharePostModal from './SharePostModal';
import RepostModal from './RepostModal';
import QuotedPostEmbed, { type QuotedPost } from './QuotedPostEmbed';
import SportPostBody from './SportPostBody';
import { isAutoRoundCaption } from '@/lib/golf/round-caption';
import SharedRoundQuickView from './golf/SharedRoundQuickView';
import SharedRoundFullCard from './golf/SharedRoundFullCard';
import ScoreEntryModal from './golf/ScoreEntryModal';
import { getSportName, getSportIcon, getSportColor } from '@/lib/config/sports-config';
import { isActiveParticipant, isRoundLive } from '@/lib/golf/round-status';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import WorkoutPostCard from './workouts/WorkoutPostCard';
import { getHandle } from '@/lib/profile-display';
import type { CompleteGolfScorecard } from '@/types/group-posts';
import type { GolfRound } from '@/types/golf';

interface PostMedia {
  id: string;
  media_url: string;
  media_type: 'image' | 'video';
  thumbnail_url?: string | null;
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
  is_pinned?: boolean;
  tags?: string[];
  hashtags?: string[];
  golf_round?: GolfRound;
  tagged_profiles?: TaggedProfile[];
  group_scorecard?: CompleteGolfScorecard; // Shared round scorecard
  shared_post_id?: string | null; // Repost: the quoted original's id
  shared_post?: QuotedPost | null; // Gated server-side; null = unavailable to this viewer
  reposts_count?: number;
  post_category?: string | null; // Cross-cutting category (077): 'training'
}

// Module scope, so the component identity is stable across renders.
// getSportIcon is a registry lookup and its result is already stable, but a
// capitalized local used as a JSX tag is indistinguishable from an
// inline-defined component — to the linter, and to React's reconciler if that
// lookup ever stopped being stable.
function SportGlyph({ sportKey, color }: { sportKey: string; color: string }) {
  // createElement, not <Icon />: getSportIcon returns a component from a
  // registry, and binding it to a capitalized local to use as a JSX tag is
  // exactly the shape react-hooks/static-components exists to catch. This
  // creates an ELEMENT from an existing component rather than a component.
  return createElement(getSportIcon(sportKey), { size: 14, style: { color } });
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
  /** Feed passes this to prepend the created repost. */
  onReposted?: (post: unknown) => void;
  /** One-shot: open the viewer's own score entry once the shared-round
   *  scorecard is available (resume-banner deep link). */
}

function PostCard({
  post,
  currentUserId,
  onLike,
  onComment,
  onDelete,
  onEdit,
  onCommentCountChange,
  showActions = true,
  onReposted,
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isPinned, setIsPinned] = useState(post.is_pinned || false);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [showFullScorecard, setShowFullScorecard] = useState(false);
  const [showScoreEntry, setShowScoreEntry] = useState(false);
  const [showRepostModal, setShowRepostModal] = useState(false);
  const [localRepostsCount, setLocalRepostsCount] = useState(post.reposts_count ?? 0);

  // What the Repost modal quotes: the card itself, or — when the card IS a
  // repost — its original (client-side root-collapse for the preview; the
  // server re-collapses authoritatively). A repost with an unavailable
  // original can't be reposted (the server would 404 the invisible root).
  const repostTarget: QuotedPost | null = post.shared_post_id
    ? post.shared_post ?? null
    : {
        id: post.id,
        caption: post.caption,
        created_at: post.created_at,
        profile: post.profile,
        media: (post.media || []).map(m => ({ media_url: m.media_url, media_type: m.media_type })),
      };
  const canRepost = !!currentUserId && !!repostTarget;

  // Shared-round live state (the live-scoring seam). Seeds from the scorecard
  // the feed loaded; subscribes to Realtime while the full card or score entry
  // is open — or while the round is actually LIVE, so the feed card itself
  // streams scores like a sports-app ticker (bounded: only live rounds hold a
  // channel). refreshScorecard() updates it imperatively right after you save.
  const [liveEnabled, setLiveEnabled] = useState(() =>
    post.group_scorecard ? isRoundLive(post.group_scorecard.group_post) : false
  );
  const { scorecard: groupScorecard, refresh: refreshScorecard, stale: scorecardStale } = useSharedRound({
    groupPostId: post.group_scorecard?.group_post.id ?? null,
    postId: post.id,
    initialScorecard: post.group_scorecard ?? null,
    enabled: showFullScorecard || showScoreEntry || liveEnabled,
  });
  // Recompute liveness from the hook's own (streamed) state every render —
  // a streamed FINAL flip or the hook's minute tick expires the badge AND
  // closes the channel. Deliberately NO dep array: the tick re-renders
  // without changing groupScorecard's identity, and time-based expiry must
  // still be re-evaluated. The functional setState bails on equality, so
  // this cannot loop.
  // Evaluated during render rather than in a dep-less effect: it runs on every
  // render either way (which is the point — the hook's minute tick re-renders
  // without changing groupScorecard's identity, and time-based expiry must
  // still be re-evaluated), and the equality guard means it cannot loop.
  {
    const next = groupScorecard ? isRoundLive(groupScorecard.group_post) : false;
    if (liveEnabled !== next) setLiveEnabled(next);
  }
  const [scoreEntryParticipantId, setScoreEntryParticipantId] = useState<string | null>(null);
  const [commentSectionOpen, setCommentSectionOpen] = useState(false);

  // Resume-banner deep link: open the viewer's own score entry once, as soon
  const [showShareModal, setShowShareModal] = useState(false);

  // The one number the post is "about", for the strip over the lead media.
  // Null when there is nothing worth overlaying — an empty strip on someone's
  // photo is worse than no strip.
  const postHeadline = buildPostHeadline(post.sport_key, {
    golfRound: post.golf_round,
    statsData: post.stats_data,
    groupScorecard: post.group_scorecard,
    viewerId: currentUserId,
  });
  const commentSectionRef = useRef<HTMLDivElement>(null);

  // Re-sync the optimistic local state when the post prop itself changes (a
  // feed refetch, say). Adjusting state DURING RENDER rather than in an effect
  // is the pattern React documents for this: it re-runs the component before
  // committing, so the stale values never paint.
  //
  // Each field is compared and applied INDEPENDENTLY, exactly as the six
  // separate effects this replaces behaved. Collapsing them into one "if
  // anything changed, reset everything" block would discard an in-flight
  // optimistic like whenever an unrelated field (a comment count, say)
  // refetched.
  const [synced, setSynced] = useState({
    likes: post.likes,
    savedPosts: post.saved_posts,
    likesCount: post.likes_count,
    commentsCount: post.comments_count,
    pinned: post.is_pinned,
    userId: currentUserId,
  });
  if (
    synced.likes !== post.likes ||
    synced.savedPosts !== post.saved_posts ||
    synced.likesCount !== post.likes_count ||
    synced.commentsCount !== post.comments_count ||
    synced.pinned !== post.is_pinned ||
    synced.userId !== currentUserId
  ) {
    if (synced.likes !== post.likes || synced.userId !== currentUserId) {
      setIsLiked(post.likes?.some(like => like.profile_id === currentUserId) || false);
    }
    if (synced.savedPosts !== post.saved_posts || synced.userId !== currentUserId) {
      setIsSaved(post.saved_posts?.some(save => save.profile_id === currentUserId) || false);
    }
    if (synced.likesCount !== post.likes_count) setLocalLikesCount(post.likes_count);
    if (synced.commentsCount !== post.comments_count) setLocalCommentsCount(post.comments_count);
    if (synced.pinned !== post.is_pinned) setIsPinned(post.is_pinned || false);
    setSynced({
      likes: post.likes,
      savedPosts: post.saved_posts,
      likesCount: post.likes_count,
      commentsCount: post.comments_count,
      pinned: post.is_pinned,
      userId: currentUserId,
    });
  }

  const displayName = formatDisplayName(
    post.profile.first_name,
    null,  // Don't include middle name in display
    post.profile.last_name,
    post.profile.full_name
  );

  const timeAgo = formatDistanceToNow(new Date(post.created_at), { addSuffix: true });

  // Chip identity: a 'training' CATEGORY post (077) wears the Training chip
  // regardless of sport_key (backfilled rows carry sport_key='general' —
  // sports-config keeps its string-keyed 'training' display entries for
  // exactly this).
  const chipKey = post.post_category === 'training' ? 'training' : post.sport_key;
  const sportColor = chipKey ? getSportColor(chipKey) : '#6B7280';

  const handleLike = () => {
    if (onLike) {
      // Optimistic heart AND count — waiting on the server made the number
      // visibly pop a beat after the heart filled. Server response via props
      // remains the source of truth and corrects any drift.
      setLocalLikesCount(prev => Math.max(0, prev + (isLiked ? -1 : 1)));
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

      // Update state from server (the saves count is not rendered here)
      setIsSaved(data.isSaved);
    } catch (e) {
      console.error('Failed to toggle saved post:', e);
      // Revert on error
      setIsSaved(isSaved);
    }
  };

  // Pin/unpin to the profile's Featured row. Optimistic like handleSave;
  // the cap error (max pins) renders inline under the header — this codebase
  // has no global toast surface reachable from an embedded card.
  const handleTogglePin = async () => {
    if (!currentUserId || pinBusy) return;
    const next = !isPinned;
    setIsPinned(next);
    setPinBusy(true);
    setPinError(null);

    try {
      const response = await fetch('/api/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ postId: post.id, action: next ? 'pin' : 'unpin' })
      });
      const data = await response.json();
      if (!response.ok) {
        setIsPinned(!next);
        setPinError(data.error || 'Failed to update pin');
        setTimeout(() => setPinError(null), 5000);
      }
    } catch (e) {
      console.error('Failed to toggle pin:', e);
      setIsPinned(!next);
      setPinError('Failed to update pin');
      setTimeout(() => setPinError(null), 5000);
    } finally {
      setPinBusy(false);
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
    <div className="bg-surface rounded-lg shadow-md border-2 border-border-strong overflow-hidden mb-6">
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
          className="flex items-center gap-4 hover:bg-surface-muted p-1 rounded-lg transition-colors flex-1 min-w-0 text-left"
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
            <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-stone-800 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-medium text-tertiary">
                {getInitials(displayName)}
              </span>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex flex-col">
              {/* min-w-0 + truncate: long name/handle must shrink, not push the
                  owner edit/delete buttons off a 360px card */}
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="font-bold text-primary text-base hover:text-brand-fg transition-colors truncate">{displayName}</h3>
                {getHandle(post.profile) && (
                  <span className="text-sm text-primary font-medium truncate flex-shrink-[2]">{getHandle(post.profile)}</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-secondary font-medium">{timeAgo}</span>
                {chipKey && (
                  <>
                    <span className="text-sm text-secondary font-medium">•</span>
                    <div className="flex items-center gap-1">
                      <SportGlyph sportKey={chipKey} color={sportColor} />
                      <span className="text-sm text-secondary font-semibold">{getSportName(chipKey)}</span>
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
            <div className="text-xs text-muted bg-surface-sunken px-2 py-1 rounded">
              Private
            </div>
          )}

          {/* Pin, Edit and Delete buttons - only show for post owner */}
          {isOwner && (
            <>
              <button
                onClick={handleTogglePin}
                disabled={pinBusy}
                className={`transition-colors p-2 min-w-[44px] min-h-[44px] rounded-full hover:bg-amber-50 dark:hover:bg-amber-950/40 flex items-center justify-center disabled:opacity-60 ${
                  isPinned ? 'text-amber-500 hover:text-amber-600' : 'text-primary hover:text-amber-500'
                }`}
                title={isPinned ? 'Unpin from profile' : 'Pin to profile'}
                aria-label={isPinned ? 'Unpin from profile' : 'Pin to profile'}
                aria-pressed={isPinned}
              >
                <i className="fas fa-thumbtack text-sm"></i>
              </button>
              <button
                onClick={() => onEdit?.(post.id)}
                className="text-primary hover:text-brand-fg transition-colors p-2 min-w-[44px] min-h-[44px] rounded-full hover:bg-brand-soft flex items-center justify-center"
                title="Edit post"
              >
                <i className="fas fa-edit text-sm"></i>
              </button>
              <button
                onClick={handleDeleteClick}
                className="text-primary hover:text-red-600 transition-colors p-2 min-w-[44px] min-h-[44px] rounded-full hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center"
                title="Delete post"
              >
                <i className="fas fa-trash text-sm"></i>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Pin error (e.g. featured-posts cap reached) */}
      {pinError && (
        <div className="px-4 pb-2 text-sm text-red-600 dark:text-red-400 font-medium" role="alert">
          {pinError}
        </div>
      )}

      {/* Media */}
      {post.media && post.media.length > 0 && (
        <div
          className="relative bg-surface-sunken"
          onTouchStart={handleMediaTouchStart}
          onTouchEnd={handleMediaTouchEnd}
        >
          {/* A FIXED 4:5 frame, with the media cropped to fill it.
              LazyImage was handed width={600} height={600}, which it turns into
              an inline style="width:600px;height:600px" — inline styles beat
              the `w-full h-auto` classes beside them, so every image was forced
              into a square box regardless of its shape. A 600x400 photo came
              out stretched into a void, which is exactly why a round with
              photos could read as "stats only, no media".

              The frame also gives the stat strip something stable to sit on. */}
          <div className="relative w-full aspect-[4/5] sm:aspect-square bg-gray-900">
            {post.media[currentMediaIndex].media_type === 'image' ? (
              <MediaTile
                src={post.media[currentMediaIndex].media_url}
                kind="image"
                alt="Post media"
                className="absolute inset-0 h-full w-full"
                sizes="(max-width: 640px) 100vw, 600px"
              />
            ) : (
              <video
                src={post.media[currentMediaIndex].media_url}
                poster={post.media[currentMediaIndex].thumbnail_url ?? undefined}
                className="absolute inset-0 h-full w-full object-contain"
                controls
                playsInline
              />
            )}

            {/* Broadcast-style lower third. Only on the FIRST item — it labels
                the post, not each photo — and only when there is a number worth
                showing. */}
            {postHeadline && currentMediaIndex === 0 && (
              <MediaStatStrip headline={postHeadline} />
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
                      index === currentMediaIndex ? 'bg-surface' : 'bg-surface/50'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Content */}
      <div className="px-4 sm:px-6 py-4">
        {/* Caption. Hidden when it is the composer's own "Golf at <course>"
            template and the card already shows that course — otherwise a golf
            photo post says the course three times (media strip, here, and the
            stat card). Only the template verbatim is dropped; anything the
            athlete typed survives. */}
        {post.caption && !isAutoRoundCaption(post.caption, postHeadline?.moment) && (
          <p className="text-primary text-base font-medium leading-relaxed mb-3 break-words">{post.caption}</p>
        )}

        {/* Quoted original (repost) — the caption above is the reposter's
            commentary; tapping the embed opens the original. */}
        {post.shared_post_id !== undefined && post.shared_post_id !== null && (
          <div className="mb-3">
            <QuotedPostEmbed
              post={post.shared_post ?? null}
              onClick={post.shared_post ? () => router.push(`/feed?post=${post.shared_post!.id}`) : undefined}
            />
          </div>
        )}

        {/* Hashtags */}
        {post.hashtags && post.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {post.hashtags.map((hashtag, index) => (
              <span
                key={index}
                className="text-brand-fg hover:text-brand-fg-strong cursor-pointer text-base font-bold"
              >
                {hashtag}
              </span>
            ))}
          </div>
        )}

        {/* Tags - Display tagged users/organizations */}
        {post.tagged_profiles && post.tagged_profiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-sm text-tertiary">with</span>
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-soft hover:bg-violet-100 dark:hover:bg-violet-950/60 text-brand-fg-strong text-sm rounded-full font-semibold border border-violet-200 dark:border-violet-800 transition-colors"
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
                    <div className="w-4 h-4 rounded-full bg-violet-200 dark:bg-violet-800 flex items-center justify-center">
                      <span className="text-[8px] font-medium text-brand-fg-strong">
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
          hasMedia={!!post.media && post.media.length > 0}
          groupScorecard={groupScorecard as Record<string, unknown> | null}
          viewerId={currentUserId}
          author={post.profile}
          onExpandScorecard={groupScorecard ? () => setShowFullScorecard(true) : undefined}
        />

        {/* Shared Round Scorecard — LIVE rounds only.
            A finished round is fully described by the card above (course,
            to-par, every player with their score, and a way into the full
            scorecard), so rendering this too said everything twice. A live
            round is different: this carries score entry, the live badge and
            the creator's end-round control, none of which the card
            replicates. */}
        {groupScorecard && isRoundLive(groupScorecard.group_post) && (
          <SharedRoundQuickView
            scorecard={groupScorecard}
            onExpand={() => setShowFullScorecard(true)}
            currentUserId={currentUserId}
            stale={scorecardStale}
            onStatusChange={refreshScorecard}
          />
        )}

        {/* Vitals badge — shown on training posts created from a vitals entry */}
        {post.stats_data?.type === 'vitals_entry' && (
          <div className="flex items-center gap-2 px-3 py-2 bg-brand-soft rounded-lg text-sm mb-2">
            <i className="fas fa-dumbbell text-violet-500 text-xs"></i>
            <span className="font-semibold text-brand-fg-strong">
              {post.stats_data.metric_label as string}
            </span>
            <span className="text-brand-fg font-medium">
              {post.stats_data.value_display as string}
            </span>
          </div>
        )}

        {/* Workout card — shared Edge Vitals sessions (compact summary from
            denormalized stats_data; Details lazy-fetches the breakdown) */}
        {post.stats_data?.type === 'workout_session' && (
          <WorkoutPostCard statsData={post.stats_data} />
        )}

      </div>

      {/* Actions — at the BOTTOM of the card, directly above the comments
          bar (Tom's call, Aug 9: engage after you've seen the whole post).
          border-t here + CommentSection's own border-t sandwich the row in
          hairlines. The row deliberately isn't tied to the media — it closes
          whatever the post contains. */}
      {showActions && (
        <div className="px-base py-micro border-t border-border-subtle">
          <div className="flex items-center gap-base">
            <button
              onClick={handleLike}
              className={`flex items-center gap-2 text-base font-bold transition-colors min-h-[44px] ${
                isLiked ? 'text-red-600 dark:text-red-400' : 'text-primary hover:text-red-600'
              }`}
            >
              <i className={`${isLiked ? 'fas' : 'far'} fa-heart text-lg`}></i>
              <span>{localLikesCount}</span>
            </button>

            <button
              onClick={handleComment}
              className="flex items-center gap-2 text-base font-bold text-primary hover:text-brand-fg transition-colors min-h-[44px]"
            >
              <i className="far fa-comment text-lg"></i>
              <span>{localCommentsCount}</span>
            </button>

            {canRepost && (
              <button
                onClick={() => setShowRepostModal(true)}
                className="flex items-center gap-2 text-base font-bold text-primary hover:text-brand-fg transition-colors min-h-[44px] min-w-[44px] justify-center"
                title="Repost"
                aria-label="Repost"
              >
                <i className="fas fa-retweet text-lg"></i>
                {localRepostsCount > 0 && <span>{localRepostsCount}</span>}
              </button>
            )}

            {/* Icon-only actions: min-w so the tap target isn't just the
                ~20px glyph (like/comment get width from their counts) */}
            <button
              onClick={handleShare}
              className="flex items-center justify-center text-base font-bold text-primary hover:text-green-600 transition-colors min-h-[44px] min-w-[44px]"
              title="Share post"
              aria-label="Share post"
            >
              <i className="far fa-share-square text-lg"></i>
            </button>

            <button
              onClick={handleSave}
              className={`flex items-center justify-center text-base font-bold transition-colors ml-auto min-h-[44px] min-w-[44px] ${
                isSaved ? 'text-yellow-600 dark:text-yellow-400' : 'text-primary hover:text-yellow-600'
              }`}
              title={isSaved ? 'Unsave post' : 'Save post'}
              aria-label={isSaved ? 'Unsave post' : 'Save post'}
            >
              <i className={`${isSaved ? 'fas' : 'far'} fa-bookmark text-lg`}></i>
            </button>
          </div>
        </div>
      )}

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
      {showFullScorecard && groupScorecard && (
        <SharedRoundFullCard
          scorecard={groupScorecard}
          currentUserId={currentUserId}
          onStatusChange={refreshScorecard}
          onMediaChanged={refreshScorecard}
          onClose={() => setShowFullScorecard(false)}
          onAddScores={async (participantId) => {
            // Refetch BEFORE opening score entry so existingScores are
            // current (the cached payload can miss holes saved elsewhere —
            // another device, the keepalive flush, a missed Realtime event).
            // On refresh failure we proceed with cached data: entering scores
            // offline-ish still works, the upsert reconciles.
            await refreshScorecard();
            setScoreEntryParticipantId(participantId);
            setShowFullScorecard(false);
            setShowScoreEntry(true);
          }}
        />
      )}

      {/* Score Entry Modal — keyed by participant so switching players
          remounts with that player's card (and their resume position) */}
      {showScoreEntry && groupScorecard && scoreEntryParticipantId && (
        <ScoreEntryModal
          key={scoreEntryParticipantId}
          groupPostId={groupScorecard.group_post.id}
          participantId={scoreEntryParticipantId}
          holesPlayed={groupScorecard.golf_data.holes_played}
          holeData={groupScorecard.golf_data.hole_data ?? null}
          courseName={groupScorecard.golf_data.course_name}
          uploaderId={currentUserId}
          players={
            // Creator can switch between players; others score only themselves
            groupScorecard.group_post.creator_id === currentUserId
              ? groupScorecard.participants
                  .filter(p => isActiveParticipant(p.participant.status))
                  .map(p => ({
                    participantId: p.participant.id,
                    name: formatDisplayName(
                      p.participant.profile?.first_name ?? null,
                      null,
                      p.participant.profile?.last_name ?? null,
                      p.participant.profile?.full_name ?? null
                    ),
                    avatarUrl: p.participant.profile?.avatar_url ?? null,
                    holesCompleted: p.scores.holes_completed ?? 0,
                    isSelf: p.participant.profile_id === currentUserId,
                  }))
              : undefined
          }
          onSwitchPlayer={
            groupScorecard.group_post.creator_id === currentUserId
              ? (id) => setScoreEntryParticipantId(id)
              : undefined
          }
          playerName={(() => {
            // Label whose card is open when it isn't the entrant's own
            const p = groupScorecard.participants.find(
              x => x.participant.id === scoreEntryParticipantId
            );
            if (!p || p.participant.profile_id === currentUserId) return undefined;
            return formatDisplayName(
              p.participant.profile?.first_name ?? null,
              null,
              p.participant.profile?.last_name ?? null,
              p.participant.profile?.full_name ?? null
            );
          })()}
          existingScores={
            groupScorecard.participants
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

              // Update the shared-round state through the single seam. Other
              // players watching this round get the same update live via the
              // hook's Realtime subscription.
              await refreshScorecard();
              setShowScoreEntry(false);
              setScoreEntryParticipantId(null);
              setShowFullScorecard(true);
            } catch (err) {
              throw err;
            }
          }}
          onSaveHole={async (hole) => {
            // LIVE per-hole save. Upserts this one hole; the DB trigger
            // recalculates totals → fires the Realtime event → co-players'
            // useSharedRound refreshes their leaderboard. The entrant's own
            // card refreshes on close (below).
            const response = await fetch(`/api/golf/scorecards/${scoreEntryParticipantId}/scores`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scores: [hole] })
            });
            if (!response.ok) {
              const data = await response.json();
              throw new Error(data.error || 'Failed to save hole');
            }
          }}
          onClose={async () => {
            await refreshScorecard();
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

      {/* Repost Modal */}
      {repostTarget && (
        <RepostModal
          isOpen={showRepostModal}
          onClose={() => setShowRepostModal(false)}
          quotedPost={repostTarget}
          onReposted={(created) => {
            // The count lives on the ORIGINAL — bump locally only when this
            // card IS the original being reposted.
            if (!post.shared_post_id) {
              setLocalRepostsCount(c => c + 1);
            }
            onReposted?.(created);
          }}
        />
      )}
    </div>
  );
}

// Memoized: feed-level state changes (toasts, realtime inserts) re-rendered
// every card including heavy scorecard subtrees.
export default memo(PostCard);
