'use client';

import { useState, useEffect } from 'react';
import PostCard from './PostCard';
import { useToast } from './Toast';

interface Post {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: any;
  visibility: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  profile: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
  };
  media: {
    id: string;
    media_url: string;
    media_type: 'image' | 'video';
    display_order: number;
  }[];
  likes?: { profile_id: string }[];
}

interface RecentPostsProps {
  profileId: string;
  currentUserId?: string;
  showCreateButton?: boolean;
  onCreatePost?: () => void;
  onPostsLoad?: (count: number) => void;
}

export default function RecentPosts({
  profileId,
  currentUserId,
  showCreateButton = true,
  onCreatePost,
  onPostsLoad
}: RecentPostsProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showError, showSuccess } = useToast();


  useEffect(() => {
    loadPosts();
  }, [profileId]);

  const loadPosts = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/posts?userId=${profileId}&limit=10`);
      
      if (!response.ok) {
        throw new Error('Failed to load posts');
      }
      
      const data = await response.json();
      const postsData = data.posts || [];
      setPosts(postsData);
      setError(null);
      
      // Notify parent of posts count
      onPostsLoad?.(postsData.length);
    } catch (err) {
      setError('Failed to load posts');
      showError('Error', 'Failed to load posts');
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async (postId: string) => {
    if (!currentUserId) {
      showError('Authentication Required', 'Please log in to like posts');
      return;
    }

    try {
      const response = await fetch('/api/posts/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, profileId: currentUserId })
      });

      if (!response.ok) {
        throw new Error('Failed to like post');
      }

      const data = await response.json();
      const isLiking = data.action === 'liked';

      // Update local state with actual count from database
      setPosts(prevPosts =>
        prevPosts.map(post => {
          if (post.id === postId) {
            return {
              ...post,
              likes_count: data.likesCount,
              likes: isLiking
                ? [...(post.likes || []), { profile_id: currentUserId }]
                : post.likes?.filter(like => like.profile_id !== currentUserId)
            };
          }
          return post;
        })
      );
    } catch (err) {
      showError('Error', 'Failed to like post');
    }
  };

  const handleComment = (postId: string) => {
    // Comments are handled within CommentSection component
  };

  const handleCommentCountChange = (postId: string, newCount: number) => {
    // Update the local state with new comment count
    setPosts(prevPosts =>
      prevPosts.map(post =>
        post.id === postId
          ? { ...post, comments_count: newCount }
          : post
      )
    );
  };

  const handleDelete = async (postId: string) => {
    try {
      const response = await fetch(`/api/posts?postId=${postId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete post');
      }

      // Remove post from local state
      setPosts(prevPosts => prevPosts.filter(post => post.id !== postId));
      showSuccess('Success', 'Post deleted successfully');

      // Notify parent of posts count change
      onPostsLoad?.(posts.length - 1);
    } catch (err) {
      console.error('Delete post error:', err);
      showError('Error', err instanceof Error ? err.message : 'Failed to delete post');
    }
  };

  if (loading) {
    return (
      <div className="space-y-base">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Recent Posts</h2>
        </div>
        <div className="flex items-center justify-center py-section">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-gray-600">Loading posts...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-base">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Recent Posts</h2>
        </div>
        <div className="text-center py-section">
          <div className="text-red-500 mb-2">
            <i className="fas fa-exclamation-triangle text-2xl"></i>
          </div>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={loadPosts}
            className="mt-2 text-blue-600 hover:text-blue-700 text-sm"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-base">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Recent Posts</h2>
        {showCreateButton && onCreatePost && (
          <button
            onClick={onCreatePost}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm font-medium"
          >
            <i className="fas fa-plus"></i>
            Create Post
          </button>
        )}
      </div>

      {posts.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-section text-center">
          <div className="text-gray-400 mb-4">
            <i className="fas fa-camera text-4xl"></i>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No posts yet</h3>
          <p className="text-gray-600 mb-4">
            {profileId === currentUserId 
              ? "Share your athletic achievements and moments!" 
              : "This athlete hasn't shared any posts yet."}
          </p>
          {showCreateButton && onCreatePost && profileId === currentUserId && (
            <button
              onClick={onCreatePost}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Create Your First Post
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-base">
          {posts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              onLike={handleLike}
              onComment={handleComment}
              onDelete={handleDelete}
              onCommentCountChange={handleCommentCountChange}
              showActions={true}
            />
          ))}
          
          {posts.length >= 10 && (
            <div className="text-center py-4">
              <button className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                Load More Posts
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}