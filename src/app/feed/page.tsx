'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import PostCard from '@/components/PostCard';
import CreatePostModal from '@/components/CreatePostModal';
import EditPostModal from '@/components/EditPostModal';
import AdvancedSearchBar from '@/components/AdvancedSearchBar';
import NotificationBell from '@/components/NotificationBell';
import ConnectionSuggestions from '@/components/ConnectionSuggestions';
import { ToastContainer, useToast } from '@/components/Toast';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { AvatarImage } from '@/components/OptimizedImage';

interface Post {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: Record<string, unknown> | null;
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
  tags?: string[];
  hashtags?: string[];
}

export default function FeedPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [isCreatePostModalOpen, setIsCreatePostModalOpen] = useState(false);
  const [isEditPostModalOpen, setIsEditPostModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const { toasts, dismissToast, showError, showSuccess } = useToast();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  // Load feed on mount
  useEffect(() => {
    if (user) {
      loadFeed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Real-time subscription for new posts
  useEffect(() => {
    if (!user) return;

    const supabase = getSupabaseBrowserClient();

    console.log('[REALTIME] Setting up posts subscription');

    // Subscribe to INSERT events on posts table
    const channel = supabase
      .channel('feed-posts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'posts',
          filter: `visibility=eq.public`
        },
        async (payload: any) => {
          console.log('[REALTIME] New post detected:', payload.new);

          // Fetch the complete post with profile and media
          const { data: newPost } = await supabase
            .from('posts')
            .select(`
              id,
              caption,
              sport_key,
              stats_data,
              visibility,
              created_at,
              likes_count,
              comments_count,
              profile:profile_id (
                id,
                first_name,
                middle_name,
                last_name,
                full_name,
                avatar_url
              ),
              media:post_media (
                id,
                media_url,
                media_type,
                display_order
              )
            `)
            .eq('id', payload.new.id)
            .single();

          if (newPost) {
            setPosts(prev => [newPost as Post, ...prev]);
            showSuccess('New Post', 'A new post has been added to your feed');
          }
        }
      )
      .subscribe();

    return () => {
      console.log('[REALTIME] Cleaning up posts subscription');
      supabase.removeChannel(channel);
    };
  }, [user, showSuccess]);

  // Real-time subscription for post updates (likes, comments)
  useEffect(() => {
    if (!user) return;

    const supabase = getSupabaseBrowserClient();

    console.log('[REALTIME] Setting up post updates subscription');

    const channel = supabase
      .channel('feed-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'posts'
        },
        (payload: any) => {
          console.log('[REALTIME] Post updated:', payload.new);

          setPosts(prev =>
            prev.map(post =>
              post.id === payload.new.id
                ? {
                    ...post,
                    likes_count: payload.new.likes_count,
                    comments_count: payload.new.comments_count,
                    caption: payload.new.caption,
                    stats_data: payload.new.stats_data
                  }
                : post
            )
          );
        }
      )
      .subscribe();

    return () => {
      console.log('[REALTIME] Cleaning up updates subscription');
      supabase.removeChannel(channel);
    };
  }, [user]);

  const loadFeed = async (loadMore = false) => {
    try {
      if (!loadMore) {
        setFeedLoading(true);
      }

      const currentPage = loadMore ? page + 1 : 0;
      const offset = currentPage * 20;
      
      const response = await fetch(`/api/posts?limit=20&offset=${offset}`);
      
      if (!response.ok) {
        throw new Error('Failed to load feed');
      }
      
      const data = await response.json();
      const newPosts = data.posts || [];
      
      if (loadMore) {
        setPosts(prev => [...prev, ...newPosts]);
        setPage(currentPage);
      } else {
        setPosts(newPosts);
        setPage(0);
      }
      
      setHasMore(newPosts.length === 20);
      
    } catch (error) {
      console.error('Feed load error:', error);
      showError('Error', 'Failed to load feed');
    } finally {
      setFeedLoading(false);
    }
  };

  const handleLike = async (postId: string) => {
    if (!user) {
      showError('Authentication Required', 'Please log in to like posts');
      return;
    }

    console.log(`[FEED] handleLike called for post ${postId}`);

    try {
      const response = await fetch('/api/posts/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, profileId: user.id })
      });

      if (!response.ok) {
        throw new Error('Failed to like post');
      }

      const data = await response.json();
      const isLiking = data.action === 'liked';

      console.log(`[FEED] API returned action: ${data.action}, count: ${data.likesCount}`);

      // Update local state with actual count from database
      setPosts(prevPosts =>
        prevPosts.map(post => {
          if (post.id === postId) {
            console.log(`[FEED] Updating post ${postId}: old count ${post.likes_count} -> new count ${data.likesCount}`);
            return {
              ...post,
              likes_count: data.likesCount,
              likes: isLiking
                ? [...(post.likes || []), { profile_id: user.id }]
                : post.likes?.filter(like => like.profile_id !== user.id)
            };
          }
          return post;
        })
      );
    } catch (error) {
      console.error('Like error:', error);
      showError('Error', 'Failed to like post');
    }
  };

  // Comments are handled within CommentSection component
  // const handleComment = (postId: string) => {
  //   // Reserved for future use
  // };

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

  const handlePostCreated = () => {
    // Refresh the feed when a new post is created
    loadFeed();
    setIsCreatePostModalOpen(false);
    showSuccess('Success', 'Post created successfully!');
  };

  const handleEdit = (postId: string) => {
    const post = posts.find(p => p.id === postId);
    if (post) {
      setEditingPost(post);
      setIsEditPostModalOpen(true);
    }
  };

  const handlePostUpdated = () => {
    // Refresh the feed when a post is updated
    loadFeed();
    setIsEditPostModalOpen(false);
    setEditingPost(null);
    showSuccess('Success', 'Post updated successfully!');
  };

  // Show loading state
  if (loading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Left - Logo & Navigation */}
            <div className="flex items-center gap-6">
              <h1 className="text-xl font-bold text-gray-900">Edge Athlete</h1>
              <nav className="hidden md:flex items-center gap-6">
                <button
                  onClick={() => router.push('/feed')}
                  className="text-blue-600 hover:text-blue-700 font-medium border-b-2 border-blue-600"
                >
                  Feed
                </button>
                <button
                  onClick={() => router.push('/athlete')}
                  className="text-gray-700 hover:text-gray-900 font-medium"
                >
                  Profile
                </button>
                <a href="#" className="text-gray-700 hover:text-gray-900 font-medium">Explore</a>
                <a href="#" className="text-gray-700 hover:text-gray-900 font-medium">Following</a>
              </nav>
            </div>

            {/* Right - Actions & Profile */}
            <div className="flex items-center gap-4">
              <NotificationBell />
              <button
                onClick={() => router.push('/app/followers')}
                className="text-gray-600 hover:text-gray-900"
                title="Followers & Connections"
              >
                <i className="fas fa-user-friends text-lg"></i>
              </button>
              <button
                onClick={() => setIsCreatePostModalOpen(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <i className="fas fa-plus"></i>
                Post
              </button>

              {/* Profile Dropdown */}
              <div className="relative">
                <button
                  onClick={() => router.push('/athlete')}
                  className="flex items-center gap-2 hover:bg-gray-100 rounded-lg p-1 transition-colors"
                  title="Go to Profile"
                >
                  <AvatarImage
                    src={profile?.avatar_url}
                    alt="Profile"
                    size={32}
                    fallbackInitials={getInitials(formatDisplayName(profile?.first_name, profile?.middle_name, profile?.last_name, profile?.full_name))}
                  />
                  <span className="hidden md:block text-sm font-medium text-gray-700">
                    {formatDisplayName(profile?.first_name, profile?.middle_name, profile?.last_name, profile?.full_name)}
                  </span>
                  <i className="fas fa-chevron-down text-xs text-gray-500"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Search Bar - Below Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="max-w-2xl">
            <AdvancedSearchBar />
          </div>
        </div>
      </div>

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-8">
            {/* Stories Section */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
              <div className="flex items-center gap-4 overflow-x-auto">
                {/* Add Story */}
                <div className="flex-shrink-0 text-center">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center cursor-pointer">
                    <i className="fas fa-plus text-white text-lg"></i>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Add Story</p>
                </div>
                {/* Story placeholders */}
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="flex-shrink-0 text-center">
                    <div className="w-16 h-16 bg-gray-200 rounded-full cursor-pointer"></div>
                    <p className="text-xs text-gray-600 mt-1">Athlete {i}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Post Creation Form */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-300 rounded-full"></div>
                <button
                  onClick={() => setIsCreatePostModalOpen(true)}
                  className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-left text-gray-500 hover:bg-gray-200 transition-colors"
                >
                  What&apos;s on your mind, {profile?.first_name || 'Athlete'}?
                </button>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-4">
                  <button className="flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors">
                    <i className="fas fa-image text-green-500"></i>
                    <span className="text-sm">Photo/Video</span>
                  </button>
                  <button className="flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors">
                    <i className="fas fa-chart-line text-blue-500"></i>
                    <span className="text-sm">Stats</span>
                  </button>
                  <button className="flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors">
                    <i className="fas fa-trophy text-yellow-500"></i>
                    <span className="text-sm">Achievement</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Posts Feed */}
            <div className="space-y-6 bg-white rounded-lg border-2 border-gray-300 p-6">
              {feedLoading ? (
                <div className="space-y-6">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-white rounded-lg shadow-md border-2 border-gray-300 p-4 animate-pulse mb-6">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                        <div className="flex-1">
                          <div className="h-4 bg-gray-200 rounded w-24 mb-1"></div>
                          <div className="h-3 bg-gray-200 rounded w-16"></div>
                        </div>
                      </div>
                      <div className="aspect-square bg-gray-200 rounded-lg mb-4"></div>
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    </div>
                  ))}
                </div>
              ) : posts.length === 0 ? (
                <div className="bg-white rounded-lg shadow-md border-2 border-gray-300 p-8 text-center">
                  <div className="text-gray-400 mb-4">
                    <i className="fas fa-users text-4xl"></i>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No posts yet</h3>
                  <p className="text-gray-600 mb-6">
                    Be the first to share something! Create a post to get the community started.
                  </p>
                  <button
                    onClick={() => setIsCreatePostModalOpen(true)}
                    className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Create First Post
                  </button>
                </div>
              ) : (
                <>
                  {posts.map(post => (
                    <PostCard
                      key={post.id}
                      post={post}
                      currentUserId={user.id}
                      onLike={handleLike}
                      onComment={() => {}}
                      onEdit={handleEdit}
                      onCommentCountChange={handleCommentCountChange}
                      showActions={true}
                    />
                  ))}
                  
                  {hasMore && (
                    <div className="text-center py-4">
                      <button
                        onClick={() => loadFeed(true)}
                        className="bg-white text-blue-600 border border-blue-600 px-6 py-2 rounded-lg hover:bg-blue-50 transition-colors font-medium"
                      >
                        Load More
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-4 space-y-6">
            {/* Connection Suggestions */}
            {user && (
              <ConnectionSuggestions profileId={user.id} limit={5} compact={true} />
            )}

            {/* Upcoming Events */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-900">Upcoming Events</h3>
                <button className="text-blue-600 text-sm hover:text-blue-700">View Calendar</button>
              </div>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      <div className="text-center">
                        <p className="text-xs text-gray-500 uppercase">Apr</p>
                        <p className="font-bold text-lg text-gray-900">{15 + i}</p>
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-sm text-gray-900">Event Title</h4>
                        <p className="text-xs text-gray-500">Location • Time</p>
                        <p className="text-xs text-blue-600">Sport Category</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Associated Teams */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-900">Your Teams</h3>
                <button className="text-blue-600 text-sm hover:text-blue-700">Manage</button>
              </div>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-200 rounded-lg"></div>
                    <div className="flex-1">
                      <p className="font-medium text-sm text-gray-900">Team Name</p>
                      <p className="text-xs text-gray-500">League • Season</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium text-green-600">Active</p>
                      <p className="text-xs text-gray-500">12 members</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Explore Reels */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-900">Explore Reels</h3>
                <button className="text-blue-600 text-sm hover:text-blue-700">View All</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="aspect-[3/4] bg-gray-200 rounded-lg relative cursor-pointer group">
                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all rounded-lg flex items-center justify-center">
                      <i className="fas fa-play text-white opacity-0 group-hover:opacity-100 transition-opacity"></i>
                    </div>
                    <div className="absolute bottom-2 left-2 right-2">
                      <p className="text-white text-xs font-medium">Reel Title</p>
                      <p className="text-white text-xs opacity-75">@athlete</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Post Modal */}
      <CreatePostModal
        isOpen={isCreatePostModalOpen}
        onClose={() => setIsCreatePostModalOpen(false)}
        userId={user?.id || ''}
        onPostCreated={handlePostCreated}
      />

      {/* Edit Post Modal */}
      {editingPost && (
        <EditPostModal
          isOpen={isEditPostModalOpen}
          onClose={() => {
            setIsEditPostModalOpen(false);
            setEditingPost(null);
          }}
          post={editingPost}
          onPostUpdated={handlePostUpdated}
        />
      )}

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}