'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Image from 'next/image';
import { Comment } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import EmojiPickerButton from '@/components/EmojiPickerButton';
import GifPickerModal from '@/components/GifPickerModal';
import {
  COMPOSER_MIN_HEIGHT,
  COMPOSER_MAX_HEIGHT,
  composerTextareaHeight,
} from '@/components/messages/composer-layout';

interface CommentSectionProps {
  postId: string;
  postOwnerId?: string;
  initialCommentsCount?: number;
  isOpen?: boolean;
  onCommentCountChange?: (newCount: number) => void;
}

export default function CommentSection({
  postId,
  postOwnerId,
  initialCommentsCount = 0,
  isOpen,
  onCommentCountChange
}: CommentSectionProps) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsCount, setCommentsCount] = useState(initialCommentsCount);
  const [newComment, setNewComment] = useState('');
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [error, setError] = useState('');
  const [likingComments, setLikingComments] = useState<Set<string>>(new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyGifUrl, setReplyGifUrl] = useState<string | null>(null);
  const [showReplyGifPicker, setShowReplyGifPicker] = useState(false);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);

  // Organize comments into threads
  const { rootComments, repliesByParent } = useMemo(() => {
    const roots: Comment[] = [];
    const replies: Record<string, Comment[]> = {};

    comments.forEach(comment => {
      if (comment.parent_comment_id) {
        if (!replies[comment.parent_comment_id]) {
          replies[comment.parent_comment_id] = [];
        }
        replies[comment.parent_comment_id].push(comment);
      } else {
        roots.push(comment);
      }
    });

    // Sort roots: pinned first, then by likes (desc), then chronological
    roots.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      const likeDiff = (b.likes_count || 0) - (a.likes_count || 0);
      if (likeDiff !== 0) return likeDiff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    // Sort replies chronologically within each parent
    Object.values(replies).forEach(arr => {
      arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    });

    return { rootComments: roots, repliesByParent: replies };
  }, [comments]);

  const fetchComments = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/comments?postId=${postId}`);
      if (!response.ok) throw new Error('Failed to fetch comments');

      const data = await response.json();
      setComments(data.comments || []);
    } catch (e) {
      console.error('Failed to load comments:', e);
      setError('Failed to load comments');
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    if (showComments) {
      fetchComments();
    }
  }, [showComments, fetchComments]);

  // Both mirror props — synchronise during render so neither is a frame late.
  const [syncedProps, setSyncedProps] = useState({ isOpen, initialCommentsCount });
  if (
    syncedProps.isOpen !== isOpen ||
    syncedProps.initialCommentsCount !== initialCommentsCount
  ) {
    setSyncedProps({ isOpen, initialCommentsCount });
    if (isOpen) setShowComments(true);
    setCommentsCount(initialCommentsCount);
  }

  // Auto-grow: measure with height reset to auto so shrinking works too.
  // Bounds come from composer-layout so comments and messages can't drift.
  const resizeTextarea = (ta: HTMLTextAreaElement | null) => {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = composerTextareaHeight(ta.scrollHeight) + 'px';
  };

  // Height is derived from the COMMITTED value, not from event timing: the
  // post-submit clear happens in an async continuation, and a rAF-scheduled
  // re-measure raced React's commit and froze the box at its grown height.
  // An effect keyed on the value always measures what's actually rendered.
  useEffect(() => {
    resizeTextarea(commentInputRef.current);
  }, [newComment]);

  useEffect(() => {
    if (replyingTo) resizeTextarea(replyInputRef.current);
  }, [replyText, replyingTo]);

  const handleEmojiSelect = (emoji: string) => {
    const input = commentInputRef.current;
    const pos = input?.selectionStart ?? newComment.length;
    const next = newComment.slice(0, pos) + emoji + newComment.slice(pos);
    setNewComment(next);
    requestAnimationFrame(() => {
      if (input) {
        input.focus();
        input.setSelectionRange(pos + emoji.length, pos + emoji.length);
      }
    });
  };

  const handleReplyEmojiSelect = (emoji: string) => {
    const input = replyInputRef.current;
    const pos = input?.selectionStart ?? replyText.length;
    const next = replyText.slice(0, pos) + emoji + replyText.slice(pos);
    setReplyText(next);
    requestAnimationFrame(() => {
      if (input) {
        input.focus();
        input.setSelectionRange(pos + emoji.length, pos + emoji.length);
      }
    });
  };

  const handleGifSelect = (url: string) => {
    setGifUrl(url);
    setShowGifPicker(false);
  };

  const handleReplyGifSelect = (url: string) => {
    setReplyGifUrl(url);
    setShowReplyGifPicker(false);
  };

  const handleSubmitComment = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newComment.trim() && !gifUrl) return;
    if (!user) return;

    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          content: newComment.trim() || null,
          gif_url: gifUrl || null,
        })
      });

      if (!response.ok) throw new Error('Failed to post comment');

      const data = await response.json();
      setComments(prev => [...prev, data.comment]);
      setNewComment('');
      setGifUrl(null);

      const newCount = data.commentsCount ?? comments.length + 1;
      setCommentsCount(newCount);
      onCommentCountChange?.(newCount);
    } catch (e) {
      console.error('Failed to post comment:', e);
      setError('Failed to post comment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitReply = async (parentCommentId: string) => {
    if (!replyText.trim() && !replyGifUrl) return;
    if (!user) return;

    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          content: replyText.trim() || null,
          gif_url: replyGifUrl || null,
          parentCommentId,
        })
      });

      if (!response.ok) throw new Error('Failed to post reply');

      const data = await response.json();
      setComments(prev => [...prev, data.comment]);
      setReplyText('');
      setReplyGifUrl(null);
      setReplyingTo(null);

      const newCount = data.commentsCount ?? comments.length + 1;
      setCommentsCount(newCount);
      onCommentCountChange?.(newCount);
    } catch (e) {
      console.error('Failed to post reply:', e);
      setError('Failed to post reply');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;

    try {
      const response = await fetch(`/api/comments?commentId=${commentId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete comment');

      const data = await response.json();
      // Remove the comment and any replies to it
      setComments(prev => prev.filter(c => c.id !== commentId && c.parent_comment_id !== commentId));

      const newCount = data.commentsCount ?? Math.max(0, comments.length - 1);
      setCommentsCount(newCount);
      onCommentCountChange?.(newCount);
    } catch (e) {
      console.error('Failed to delete comment:', e);
      setError('Failed to delete comment');
    }
  };

  const handleLikeComment = async (commentId: string) => {
    if (!user || likingComments.has(commentId)) return;

    setLikingComments(prev => new Set(prev).add(commentId));

    try {
      const response = await fetch('/api/comments/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId })
      });

      if (!response.ok) throw new Error('Failed to like comment');

      const data = await response.json();

      setComments(prevComments =>
        prevComments.map(comment =>
          comment.id === commentId
            ? {
                ...comment,
                likes_count: data.likes_count,
                comment_likes: data.isLiked
                  ? [...(comment.comment_likes || []), { profile_id: user.id }]
                  : (comment.comment_likes || []).filter(like => like.profile_id !== user.id)
              }
            : comment
        )
      );
    } catch (e) {
      console.error('Failed to like comment:', e);
      setError('Failed to like comment');
    } finally {
      setLikingComments(prev => {
        const newSet = new Set(prev);
        newSet.delete(commentId);
        return newSet;
      });
    }
  };

  const handlePinComment = async (commentId: string, isPinned: boolean) => {
    try {
      const response = await fetch('/api/comments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentId,
          postId,
          action: isPinned ? 'unpin' : 'pin'
        })
      });

      if (!response.ok) throw new Error('Failed to pin comment');

      // Update local state
      setComments(prev =>
        prev.map(c => ({
          ...c,
          is_pinned: c.id === commentId ? !isPinned : (isPinned ? c.is_pinned : false)
        }))
      );
    } catch (e) {
      console.error('Failed to pin comment:', e);
      setError('Failed to pin comment');
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;
    return date.toLocaleDateString();
  };

  const isPostOwner = user?.id === postOwnerId;

  // Render a single comment (used for both root and reply)
  const renderComment = (comment: Comment, isReply: boolean = false) => {
    const avatarSize = isReply ? 24 : 32;
    const avatarClass = isReply
      ? 'w-6 h-6 rounded-full'
      : 'w-8 h-8 rounded-full';
    const displayName = formatDisplayName(
      comment.profile?.first_name,
      null,
      comment.profile?.last_name,
      comment.profile?.full_name
    );
    const isLiked = comment.comment_likes?.some(like => like.profile_id === user?.id) ?? false;
    const replyCount = repliesByParent[comment.id]?.length || 0;

    return (
      <div key={comment.id} className="flex gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          {comment.profile?.avatar_url ? (
            <Image
              src={comment.profile.avatar_url}
              alt={displayName}
              width={avatarSize}
              height={avatarSize}
              className={`${avatarClass} object-cover`}
            />
          ) : (
            <div className={`${avatarClass} bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-semibold ${isReply ? 'text-[10px]' : 'text-xs'}`}>
              {getInitials(displayName)}
            </div>
          )}
        </div>

        {/* Comment content */}
        <div className="flex-1 min-w-0">
          <div className="bg-surface-muted rounded-lg px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-primary">
                  {displayName}
                </span>
                {comment.is_pinned && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                    <i className="fas fa-thumbtack text-[10px]" />
                    Pinned
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Pin/Unpin button (post owner only, root comments only) */}
                {isPostOwner && !isReply && (
                  <button
                    onClick={() => handlePinComment(comment.id, !!comment.is_pinned)}
                    className={`text-xs transition-colors min-w-[44px] min-h-[44px] -m-3 inline-flex items-center justify-center ${
                      comment.is_pinned
                        ? 'text-amber-600 dark:text-amber-400 hover:text-amber-700'
                        : 'text-faint hover:text-amber-600'
                    }`}
                    title={comment.is_pinned ? 'Unpin comment' : 'Pin comment'}
                  >
                    <i className="fas fa-thumbtack" />
                  </button>
                )}
                {/* Delete button (own comments only) */}
                {user?.id === comment.profile_id && (
                  <button
                    onClick={() => handleDeleteComment(comment.id)}
                    className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 min-w-[44px] min-h-[44px] -m-3 inline-flex items-center justify-center"
                    title="Delete comment"
                  >
                    <i className="fas fa-trash" />
                  </button>
                )}
              </div>
            </div>
            {comment.content && (
              <p className="text-sm text-primary whitespace-pre-wrap break-words">
                {comment.content}
              </p>
            )}
            {comment.gif_url && (
              // Raw <img>: animated Giphy GIF. The optimizer streams animated
              // sources through unchanged (zero bytes saved, one billable
              // transformation), and max-h-40/max-w-xs means the intrinsic
              // size is genuinely unknown — there is no honest width/height.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={comment.gif_url}
                alt="GIF"
                className="mt-1 rounded-lg max-h-40 max-w-xs"
                loading="lazy"
              />
            )}
          </div>

          {/* Action bar */}
          <div className="mt-1 px-3 flex items-center gap-3 text-xs text-muted">
            <span>{formatTimeAgo(comment.created_at)}</span>

            {/* Like button */}
            {user && (
              <button
                onClick={() => handleLikeComment(comment.id)}
                disabled={likingComments.has(comment.id)}
                className={`flex items-center gap-1 transition-colors py-2 px-2 -mx-1 ${
                  isLiked
                    ? 'text-red-600 dark:text-red-400 hover:text-red-700'
                    : 'text-muted hover:text-red-600'
                } disabled:opacity-50`}
                title="Like comment"
              >
                <i className={isLiked ? 'fas fa-heart' : 'far fa-heart'} />
                {comment.likes_count ? (
                  <span className="font-medium">{comment.likes_count}</span>
                ) : null}
              </button>
            )}

            {/* Reply button (only on root comments) */}
            {user && !isReply && (
              <button
                onClick={() => {
                  setReplyingTo(replyingTo === comment.id ? null : comment.id);
                  setReplyText('');
                  setReplyGifUrl(null);
                  requestAnimationFrame(() => replyInputRef.current?.focus());
                }}
                className="text-muted hover:text-brand-fg transition-colors font-medium py-2 px-2 -mx-1"
              >
                Reply{replyCount > 0 ? ` (${replyCount})` : ''}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render the reply input form. The indent steps down below `sm`: 40px of
  // indent plus five row controls overflowed a 320px card.
  const renderReplyForm = (parentCommentId: string) => (
    <div className="ml-6 sm:ml-10 mt-2">
      {/* Reply GIF preview */}
      {replyGifUrl && (
        <div className="relative inline-block mb-2">
          {/* Raw <img>: animated Giphy GIF, fixed height + auto width — no
              honest intrinsic dimensions to hand <Image>. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={replyGifUrl} alt="GIF" className="h-16 rounded-lg border border-border object-cover" />
          {/* Padding grows the 20px circle to a ~40px hit area; the visual
              circle lives on the inner span so the design doesn't change. */}
          <button
            type="button"
            onClick={() => setReplyGifUrl(null)}
            aria-label="Remove GIF"
            className="absolute -top-4 -right-4 p-3 group"
          >
            <span className="w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center group-hover:bg-red-600">
              <i className="fas fa-times text-xs"></i>
            </span>
          </button>
        </div>
      )}
      <div className="flex items-end gap-1">
        <div className="relative shrink-0">
          <EmojiPickerButton onEmojiSelect={handleReplyEmojiSelect} />
        </div>
        <button
          type="button"
          onClick={() => setShowReplyGifPicker(prev => !prev)}
          disabled={isSubmitting}
          className="shrink-0 relative after:absolute after:content-[''] after:-inset-y-2 after:inset-x-0 p-2 text-faint hover:text-violet-500 active:text-violet-500 transition-colors disabled:opacity-40 text-xs font-bold"
          title="Add a GIF"
        >
          GIF
        </button>
        {showReplyGifPicker && (
          <GifPickerModal
            title="Add a GIF"
            onGifSelect={handleReplyGifSelect}
            onClose={() => setShowReplyGifPicker(false)}
          />
        )}
        <textarea
          ref={replyInputRef}
          rows={1}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            // isComposing guard: Enter that COMMITS an IME composition must
            // not send the half-composed text (MessageInput's rule).
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSubmitReply(parentCommentId);
            }
          }}
          placeholder="Write a reply..."
          className="flex-1 min-w-0 px-3 py-1.5 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm resize-none overflow-hidden block"
          style={{ minHeight: COMPOSER_MIN_HEIGHT, maxHeight: COMPOSER_MAX_HEIGHT }}
          disabled={isSubmitting}
        />
        <button
          type="button"
          onClick={() => handleSubmitReply(parentCommentId)}
          disabled={(!replyText.trim() && !replyGifUrl) || isSubmitting}
          className="relative after:absolute after:content-[''] after:-inset-y-1.5 after:inset-x-0 px-3 py-1.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {isSubmitting ? '...' : 'Reply'}
        </button>
        <button
          type="button"
          onClick={() => { setReplyingTo(null); setReplyText(''); setReplyGifUrl(null); }}
          className="relative after:absolute after:content-[''] after:-inset-y-2 after:inset-x-0 p-1.5 text-faint hover:text-tertiary active:text-tertiary transition-colors shrink-0"
          title="Cancel"
        >
          <i className="fas fa-times text-sm"></i>
        </button>
      </div>
    </div>
  );

  return (
    <div className="border-t border-border">
      {/* Comment toggle button */}
      <button
        onClick={() => setShowComments(!showComments)}
        className="w-full px-4 py-3 text-left text-sm font-medium text-tertiary hover:bg-surface-muted transition-colors"
      >
        <i className={`fas fa-comment mr-2 ${showComments ? 'text-brand-fg' : ''}`} />
        {showComments ? 'Hide' : 'View'} Comments ({commentsCount})
      </button>

      {/* Comments section */}
      {showComments && (
        <div className="px-4 pb-4">
          {/* Comment input */}
          {user && (
            <form onSubmit={handleSubmitComment} className="mb-4">
              {/* GIF preview */}
              {gifUrl && (
                <div className="relative inline-block mb-2">
                  {/* Raw <img>: animated Giphy GIF, fixed height + auto width
                      — same reasoning as the reply composer above. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={gifUrl} alt="GIF" className="h-20 rounded-lg border border-border object-cover" />
                  {/* Same hit-area trick as the reply GIF preview above. */}
                  <button
                    type="button"
                    onClick={() => setGifUrl(null)}
                    aria-label="Remove GIF"
                    className="absolute -top-4 -right-4 p-3 group"
                  >
                    <span className="w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center group-hover:bg-red-600">
                      <i className="fas fa-times text-xs"></i>
                    </span>
                  </button>
                </div>
              )}
              <div className="flex items-end gap-1">
                {/* Emoji picker */}
                <div className="relative shrink-0">
                  <EmojiPickerButton onEmojiSelect={handleEmojiSelect} />
                </div>
                {/* GIF picker */}
                <button
                  type="button"
                  onClick={() => setShowGifPicker(prev => !prev)}
                  disabled={isSubmitting}
                  className="shrink-0 relative after:absolute after:content-[''] after:-inset-y-2 after:inset-x-0 p-2 text-faint hover:text-violet-500 active:text-violet-500 transition-colors disabled:opacity-40 text-xs font-bold"
                  title="Add a GIF"
                >
                  GIF
                </button>
                {showGifPicker && (
                  <GifPickerModal
                    title="Add a GIF"
                    onGifSelect={handleGifSelect}
                    onClose={() => setShowGifPicker(false)}
                  />
                )}
                {/* min-w-0: a text field's intrinsic min-width is ~177px, so
                    without this the flex row refuses to shrink and overflows
                    the card sideways on phones (same trap as the hashtag
                    composer in CreatePostModal). */}
                <textarea
                  ref={commentInputRef}
                  rows={1}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    // A textarea doesn't implicitly submit its form the way
                    // the old single-line input did — Enter must be wired
                    // explicitly (Shift+Enter = newline; isComposing per
                    // MessageInput's IME rule).
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSubmitComment();
                    }
                  }}
                  placeholder="Write a comment..."
                  className="flex-1 min-w-0 px-3 py-2 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm resize-none overflow-hidden block"
                  style={{ minHeight: COMPOSER_MIN_HEIGHT, maxHeight: COMPOSER_MAX_HEIGHT }}
                  disabled={isSubmitting}
                />
                <button
                  type="submit"
                  disabled={(!newComment.trim() && !gifUrl) || isSubmitting}
                  className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {isSubmitting ? 'Posting...' : 'Post'}
                </button>
              </div>
            </form>
          )}

          {/* Error message */}
          {error && (
            <div className="mb-3 p-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="text-center py-4 text-muted text-sm">
              Loading comments...
            </div>
          )}

          {/* Comments list */}
          {!isLoading && comments.length === 0 && (
            <div className="text-center py-4 text-muted text-sm">
              No comments yet. Be the first to comment!
            </div>
          )}

          {!isLoading && rootComments.length > 0 && (
            <div className="space-y-4">
              {rootComments.map((comment) => (
                <div key={comment.id}>
                  {/* Root comment */}
                  {renderComment(comment, false)}

                  {/* Replies */}
                  {repliesByParent[comment.id] && repliesByParent[comment.id].length > 0 && (
                    <div className="ml-10 mt-2 space-y-2 border-l-2 border-border pl-3">
                      {repliesByParent[comment.id].map((reply) => (
                        renderComment(reply, true)
                      ))}
                    </div>
                  )}

                  {/* Reply form */}
                  {replyingTo === comment.id && renderReplyForm(comment.id)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
