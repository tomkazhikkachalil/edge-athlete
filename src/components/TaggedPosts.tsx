'use client';

import { useState, useEffect, useCallback } from 'react';
import PostCard from './PostCard';

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
  [key: string]: unknown;
}

interface TaggedPostsProps {
  profileId: string;
  currentUserId?: string;
}

export default function TaggedPosts({ profileId, currentUserId }: TaggedPostsProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTaggedPosts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // First, get all tags for this profile
      const tagsResponse = await fetch(`/api/tags?profileId=${profileId}`);
      if (!tagsResponse.ok) {
        throw new Error('Failed to load tags');
      }

      const { tags } = await tagsResponse.json();

      if (!tags || tags.length === 0) {
        setPosts([]);
        setLoading(false);
        return;
      }

      // Get unique post IDs from tags
      const postIds = [...new Set(tags.map((tag: { post_id: string }) => tag.post_id))] as string[];

      // Fetch posts for these IDs
      const postsPromises = postIds.map(async (postId: string) => {
        const response = await fetch(`/api/posts/${postId}`);
        if (response.ok) {
          const { post } = await response.json();
          return post;
        }
        return null;
      });

      const fetchedPosts = await Promise.all(postsPromises);
      const validPosts = fetchedPosts.filter(post => post !== null);

      setPosts(validPosts);
    } catch (err) {
      console.error('Error loading tagged posts:', err);
      setError('Failed to load tagged posts');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    loadTaggedPosts();
  }, [loadTaggedPosts]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <i className="fas fa-spinner fa-spin text-3xl text-gray-400"></i>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">{error}</p>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-12">
        <i className="fas fa-tag text-4xl text-gray-300 mb-4"></i>
        <p className="text-gray-600 font-medium">No tagged posts yet</p>
        <p className="text-gray-500 text-sm mt-2">Posts where this user is tagged will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">
          Tagged Posts ({posts.length})
        </h2>
      </div>

      <div className="space-y-6">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={currentUserId}
            showActions={true}
          />
        ))}
      </div>
    </div>
  );
}
