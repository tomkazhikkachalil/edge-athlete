'use client';

import { useState, useEffect } from 'react';
import { Comment } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

interface CommentSectionProps {
  postId: string;
  initialCommentsCount?: number;
  onCommentCountChange?: (newCount: number) => void;
}

export default function CommentSection({ postId, initialCommentsCount = 0, onCommentCountChange }: CommentSectionProps) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsCount, setCommentsCount] = useState(initialCommentsCount);
  const [newComment, setNewComment] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (showComments) {
      fetchComments();
    }
  }, [showComments, postId]);

  // Update count when initialCommentsCount prop changes
  useEffect(() => {
    setCommentsCount(initialCommentsCount);
  }, [initialCommentsCount]);

  const fetchComments = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/comments?postId=${postId}`);
      if (!response.ok) throw new Error('Failed to fetch comments');

      const data = await response.json();
      const fetchedComments = data.comments || [];
      setComments(fetchedComments);

      // Don't update count here - trust the database count from props
      // Count only updates when we add/delete comments
    } catch (err) {
      console.error('Error fetching comments:', err);
      setError('Failed to load comments');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !user) return;

    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          content: newComment.trim()
        })
      });

      if (!response.ok) throw new Error('Failed to post comment');

      const data = await response.json();
      const updatedComments = [...comments, data.comment];
      setComments(updatedComments);
      setNewComment('');

      // Update local count and notify parent
      const newCount = updatedComments.length;
      setCommentsCount(newCount);
      onCommentCountChange?.(newCount);
    } catch (err) {
      console.error('Error posting comment:', err);
      setError('Failed to post comment');
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

      const updatedComments = comments.filter(c => c.id !== commentId);
      setComments(updatedComments);

      // Update local count and notify parent
      const newCount = updatedComments.length;
      setCommentsCount(newCount);
      onCommentCountChange?.(newCount);
    } catch (err) {
      console.error('Error deleting comment:', err);
      setError('Failed to delete comment');
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

  return (
    <div className="border-t border-gray-200">
      {/* Comment toggle button */}
      <button
        onClick={() => setShowComments(!showComments)}
        className="w-full px-4 py-3 text-left text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
      >
        <i className={`fas fa-comment mr-2 ${showComments ? 'text-blue-600' : ''}`} />
        {showComments ? 'Hide' : 'View'} Comments ({commentsCount})
      </button>

      {/* Comments section */}
      {showComments && (
        <div className="px-4 pb-4">
          {/* Comment input */}
          {user && (
            <form onSubmit={handleSubmitComment} className="mb-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  disabled={isSubmitting}
                />
                <button
                  type="submit"
                  disabled={!newComment.trim() || isSubmitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSubmitting ? 'Posting...' : 'Post'}
                </button>
              </div>
            </form>
          )}

          {/* Error message */}
          {error && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="text-center py-4 text-gray-500 text-sm">
              Loading comments...
            </div>
          )}

          {/* Comments list */}
          {!isLoading && comments.length === 0 && (
            <div className="text-center py-4 text-gray-500 text-sm">
              No comments yet. Be the first to comment!
            </div>
          )}

          {!isLoading && comments.length > 0 && (
            <div className="space-y-3">
              {comments.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    {comment.profile?.avatar_url ? (
                      <img
                        src={comment.profile.avatar_url}
                        alt={comment.profile.full_name || 'User'}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-semibold">
                        {(comment.profile?.full_name || 'U')[0].toUpperCase()}
                      </div>
                    )}
                  </div>

                  {/* Comment content */}
                  <div className="flex-1 min-w-0">
                    <div className="bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-sm text-gray-900">
                          {comment.profile?.full_name || comment.profile?.username || 'Unknown User'}
                        </span>
                        {user?.id === comment.profile_id && (
                          <button
                            onClick={() => handleDeleteComment(comment.id)}
                            className="text-xs text-red-600 hover:text-red-700"
                            title="Delete comment"
                          >
                            <i className="fas fa-trash" />
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                        {comment.content}
                      </p>
                    </div>
                    <div className="mt-1 px-3 text-xs text-gray-500">
                      {formatTimeAgo(comment.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
