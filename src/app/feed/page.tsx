'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import PostCard from '@/components/PostCard';
import AppHeader from '@/components/AppHeader';
import ConnectionSuggestions from '@/components/ConnectionSuggestions';
import { ToastContainer, useToast } from '@/components/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import LazyImage from '@/components/LazyImage';
import { getInitials, formatDisplayName } from '@/lib/formatters';

// Heavy modals (~2100 / ~1090 / ~330 lines) — split into their own chunks,
// loaded only when the user opens them. Cuts First Load JS on /feed.
const CreatePostModal = dynamic(() => import('@/components/CreatePostModal'), { ssr: false });
const EditPostModal = dynamic(() => import('@/components/EditPostModal'), { ssr: false });
const EditProfileTabs = dynamic(() => import('@/components/EditProfileTabs'), { ssr: false });

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

interface RealtimePostPayload {
  new: {
    id: string;
    profile_id: string;
    likes_count: number;
    comments_count: number;
    caption: string | null;
    stats_data: Record<string, unknown> | null;
  };
}

export default function FeedPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [isCreatePostModalOpen, setIsCreatePostModalOpen] = useState(false);

  // Deep link: /feed?create=1 opens the composer (used by onboarding's
  // "Log your first round"). window.location instead of useSearchParams —
  // this page is statically prerendered and must not need a Suspense wrap.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1') {
      setIsCreatePostModalOpen(true);
      window.history.replaceState(null, '', '/feed');
    }
  }, []);
  const [isEditPostModalOpen, setIsEditPostModalOpen] = useState(false);
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const loadInFlightRef = useRef(false);
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

    // Scope realtime inserts to authors this user follows. Without this, the
    // filter `visibility=eq.public` injects EVERY public post platform-wide
    // into the feed. Loaded once at subscribe time; new follows show up after
    // the next feed load, which is acceptable for a live-append nicety.
    let followedIds = new Set<string>();
    (async () => {
      const { data } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id)
        .eq('status', 'accepted');
      followedIds = new Set((data || []).map((r: { following_id: string }) => r.following_id));
    })();

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
        async (payload: RealtimePostPayload) => {
          // Own posts are handled by handlePostCreated (with full data);
          // skip here to avoid a duplicate. Others: only followed authors.
          const authorId = payload.new.profile_id;
          if (authorId === user.id) return;
          if (!followedIds.has(authorId)) return;

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
                avatar_url,
                handle
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
            setPosts(prev => {
              // Dedup guard — never render the same post id twice.
              if (prev.some(p => p.id === (newPost as Post).id)) return prev;
              return [newPost as Post, ...prev];
            });
            showSuccess('New Post', 'A new post has been added to your feed');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, showSuccess]);

  // Note: Removed unfiltered real-time subscription for post updates (likes, comments)
  // to eliminate 850K+ Realtime overhead. Using optimistic UI updates instead for
  // instant feedback like Instagram/Facebook. Feed refreshes via pull-to-refresh.

  const loadFeed = async (loadMore = false) => {
    // In-flight guard: a double-tapped "Load More" used to fetch the same
    // offset twice and append duplicate posts (duplicate React keys).
    if (loadMore && loadInFlightRef.current) return;
    loadInFlightRef.current = true;
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
        // Dedupe on append as a second line of defense
        setPosts(prev => {
          const seen = new Set(prev.map(p => p.id));
          return [...prev, ...newPosts.filter((p: { id: string }) => !seen.has(p.id))];
        });
        setPage(currentPage);
      } else {
        setPosts(newPosts);
        setPage(0);
      }
      
      // Prefer the API's hasMore (computed from the RAW pre-privacy-filter
      // page) — a filtered page can legitimately contain <20 visible posts
      // while older visible posts still exist.
      setHasMore(typeof data.hasMore === 'boolean' ? data.hasMore : newPosts.length >= 20);

    } catch (e) {
      console.error('Failed to load feed:', e);
      showError('Error', 'Failed to load feed');
    } finally {
      loadInFlightRef.current = false;
      setFeedLoading(false);
    }
  };

  const handleLike = async (postId: string) => {
    if (!user) {
      showError('Authentication Required', 'Please log in to like posts');
      return;
    }


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


      // Update local state with actual count from database
      setPosts(prevPosts =>
        prevPosts.map(post => {
          if (post.id === postId) {
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
    } catch (e) {
      console.error('Failed to like post:', e);
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

  const handlePostCreated = async (newPost: unknown) => {

    // For group posts (shared rounds), we need to fetch the complete data with scorecard
    // For regular posts, add immediately to feed
    if (newPost && typeof newPost === 'object' && 'id' in newPost) {
      // Check if it's a group post
      const postData = newPost as { id: string; type?: string };

      if (postData.type === 'golf_round') {
        // Group post - refetch to get complete scorecard data
        await loadFeed();
      } else {
        // Regular post - add immediately to top of feed
        setPosts(prevPosts => [newPost as Post, ...prevPosts]);
      }
    } else {
      // Fallback: refetch feed
      await loadFeed();
    }

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
    } catch (e) {
      console.error('Failed to delete post:', e);
      showError('Error', 'Failed to delete post');
    }
  };

  // Show loading state
  if (loading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-700 font-medium">Loading your feed...</p>
          <p className="mt-1 text-sm text-gray-500">Getting everything ready</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Unified Header */}
      <AppHeader
        showSearch={true}
        onCreatePost={() => setIsCreatePostModalOpen(true)}
        onEditProfile={() => setIsEditProfileModalOpen(true)}
      />

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
          {/* Main Content */}
          <div className="lg:col-span-8">
            {/* Post Creation Form */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4 mb-4 sm:mb-6">
              <div className="flex items-center gap-2 sm:gap-3">
                {/* User Avatar */}
                {profile?.avatar_url ? (
                  <LazyImage
                    src={profile.avatar_url}
                    alt="Your profile"
                    className="w-10 h-10 rounded-full object-cover"
                    width={40}
                    height={40}
                  />
                ) : (
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-semibold">
                      {getInitials(formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name))}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => setIsCreatePostModalOpen(true)}
                  className="flex-1 bg-gray-100 rounded-full px-3 sm:px-4 py-2 text-left text-gray-500 hover:bg-gray-200 transition-colors text-sm sm:text-base"
                >
                  What&apos;s on your mind, {profile?.first_name || 'Athlete'}?
                </button>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-2 sm:gap-4">
                  <button onClick={() => setIsCreatePostModalOpen(true)} className="flex items-center gap-1 sm:gap-2 text-gray-600 hover:text-blue-600 transition-colors">
                    <i className="fas fa-image text-green-500"></i>
                    <span className="text-xs sm:text-sm">Photo/Video</span>
                  </button>
                  <button onClick={() => setIsCreatePostModalOpen(true)} className="flex items-center gap-1 sm:gap-2 text-gray-600 hover:text-blue-600 transition-colors">
                    <i className="fas fa-chart-line text-blue-500"></i>
                    <span className="text-xs sm:text-sm hidden sm:inline">Stats</span>
                  </button>
                  <button onClick={() => setIsCreatePostModalOpen(true)} className="flex items-center gap-1 sm:gap-2 text-gray-600 hover:text-blue-600 transition-colors">
                    <i className="fas fa-trophy text-yellow-500"></i>
                    <span className="text-xs sm:text-sm hidden sm:inline">Achievement</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Posts Feed */}
            <div className="space-y-4 sm:space-y-6 bg-white rounded-lg border-2 border-gray-300 p-3 sm:p-6">
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
                      onDelete={handleDelete}
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
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900">Upcoming Events</h3>
              </div>
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center mb-3">
                  <i className="fas fa-calendar-days text-blue-400 text-lg"></i>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">No upcoming events</p>
                <p className="text-xs text-gray-400">Tournament and event scheduling is coming soon.</p>
              </div>
            </div>

            {/* Your Club */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900">Your Club</h3>
              </div>
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center mb-3">
                  <i className="fas fa-flag text-green-400 text-lg"></i>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">No club linked</p>
                <p className="text-xs text-gray-400">Club and team management is coming soon.</p>
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

      {/* Edit Profile Modal */}
      <EditProfileTabs
        isOpen={isEditProfileModalOpen}
        onClose={() => setIsEditProfileModalOpen(false)}
        profile={profile}
        badges={[]}
        highlights={[]}
        performances={[]}
        onSave={() => {
          // Profile will be refreshed automatically by useAuth
          setIsEditProfileModalOpen(false);
        }}
      />

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}