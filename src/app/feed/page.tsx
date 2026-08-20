'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth';
import { liveRoundPath } from '@/lib/golf/round-route';
import { useRouter, useSearchParams } from 'next/navigation';
import PostCard from '@/components/PostCard';
import AppHeader from '@/components/AppHeader';
import ConnectionSuggestions from '@/components/ConnectionSuggestions';
import { useToast } from '@/components/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import LazyImage from '@/components/LazyImage';
import { getInitials, formatDisplayName } from '@/lib/formatters';
import { resolveSportKey, isComposerSport } from '@/lib/sports/resolve-sport-key';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import { getEmptyStateMessage, getActivityEncouragement, COPY } from '@/lib/copy';
import LiveNowStrip from '@/components/LiveNowStrip';
import FeedCalendarWidget from '@/components/calendar/FeedCalendarWidget';
import { FEATURE_FLAGS } from '@/lib/features';

// Heavy modals (~2100 / ~1090 / ~330 lines) — split into their own chunks,
// loaded only when the user opens them. Cuts First Load JS on /feed.
const CreatePostModal = dynamic(() => import('@/components/CreatePostModal'), { ssr: false });
const EditPostModal = dynamic(() => import('@/components/EditPostModal'), { ssr: false });
const PostDetailModal = dynamic(() => import('@/components/PostDetailModal'), { ssr: false });
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
  /** Attribution (090): the human author when a guardian posted on behalf. */
  created_by?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    handle: string | null;
  } | null;
  media: {
    id: string;
    media_url: string;
    media_type: 'image' | 'video';
    display_order: number;
  }[];
  likes?: { profile_id: string }[];
  tags?: string[];
  hashtags?: string[];
  shared_post_id?: string | null;
  shared_post?: import('@/components/QuotedPostEmbed').QuotedPost | null;
  reposts_count?: number;
  post_category?: string | null;
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

// ?post= reader for search-result deep links. Unlike ?create=1 this must be
// REACTIVE: AdvancedSearchBar (inside AppHeader) pushes /feed?post=<id> while
// the user is already ON /feed, which never remounts the page — a mount-only
// window.location read would miss it. useSearchParams needs a Suspense
// boundary on this statically prerendered page, hence the tiny null child.
function PostParamReader({ onPost }: { onPost: (id: string) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const p = searchParams.get('post');
    if (p) onPost(p);
  }, [searchParams, onPost]);
  return null;
}

export default function FeedPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [isCreatePostModalOpen, setIsCreatePostModalOpen] = useState(false);

  // Deep link: /feed?create=1[&sport=<key>] opens the composer, preset to
  // the sport when given (onboarding's final CTA). window.location instead
  // of useSearchParams — this page is statically prerendered and must not
  // need a Suspense wrap. The sport must be captured BEFORE replaceState
  // scrubs the URL.
  const [deepLinkSport, setDeepLinkSport] = useState<SportKey | null>(null);
  // Effect-owned deliberately: reads window.location and scrubs it with
  // replaceState — neither is possible during render.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1') {
      const sportKey = resolveSportKey(params.get('sport'));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (isComposerSport(sportKey)) setDeepLinkSport(sportKey);
      setIsCreatePostModalOpen(true);
      window.history.replaceState(null, '', '/feed');
    }
  }, []);
  const [isEditPostModalOpen, setIsEditPostModalOpen] = useState(false);
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // "Continue scoring" banner: the user's in-progress round, if any.
  // Dismissal is per-round, per-session (sessionStorage).
  const [liveRound, setLiveRound] = useState<{
    post_id: string;
    group_post_id: string;
    participant_id: string;
    course_name: string | null;
  } | null>(null);
  const [liveBannerDismissed, setLiveBannerDismissed] = useState(false);
  // Search-result deep link (/feed?post=)
  const [deepLinkPostId, setDeepLinkPostId] = useState<string | null>(null);
  const loadInFlightRef = useRef(false);
  const [page, setPage] = useState(0);
  const { showError, showSuccess } = useToast();

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

  // The athlete's own sport drives composer defaults + empty-state copy
  const profileSportKey = resolveSportKey(profile?.sport);
  const profileDefaultSport = isComposerSport(profileSportKey) ? profileSportKey : null;

  // Check for an in-progress round to resume (live-scoring banner).
  // Golf-only feature: only poll for athletes who actually play golf
  // (declared or posted — a live round IS a golf post, so legacy null-sport
  // golfers keep the banner via the posted-sports union). A basketball
  // athlete makes zero golf requests and never sees golf UI.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const activeRes = await fetch(`/api/profile/${user.id}/active-sports`);
        if (!activeRes.ok || cancelled) return;
        const { sportKeys } = await activeRes.json();
        if (cancelled || !Array.isArray(sportKeys) || !sportKeys.includes('golf')) return;

        const res = await fetch('/api/golf/live-round');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !data.live_round) return;
        // Respect a session dismissal for THIS round (private-mode-safe)
        try {
          if (sessionStorage.getItem(`ea:live-banner-dismissed:${data.live_round.group_post_id}`)) {
            return;
          }
        } catch { /* storage unavailable — show the banner */ }
        setLiveRound(data.live_round);
      } catch { /* banner is a nicety — never break the feed over it */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const dismissLiveBanner = () => {
    setLiveBannerDismissed(true);
    if (liveRound) {
      try {
        sessionStorage.setItem(`ea:live-banner-dismissed:${liveRound.group_post_id}`, '1');
      } catch { /* best-effort */ }
    }
  };

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

          // Fetch the complete post via the API's single-post branch — it
          // does the server-side gated hydration (quoted repost originals,
          // scorecards) the browser client can't replicate under RLS, and
          // returns the feed's exact Post shape. A 404 (post the viewer
          // can't see) simply skips the prepend.
          try {
            const res = await fetch(`/api/posts?postId=${payload.new.id}`);
            if (!res.ok) return;
            const data = await res.json();
            const newPost = data.post as Post | undefined;
            if (newPost) {
              setPosts(prev => {
                // Dedup guard — never render the same post id twice.
                if (prev.some(p => p.id === newPost.id)) return prev;
                return [newPost, ...prev];
              });
              showSuccess('New Post', 'A new post has been added to your feed');
            }
          } catch { /* realtime prepend is a nicety — the next load has it */ }
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

  // Hoisted function declaration, not a `const` arrow: the mount effect above
  // calls it, and react-hooks/immutability flags a reference to a binding
  // declared later in the body.
  async function loadFeed(loadMore = false) {
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
  }

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
      const postData = newPost as { id: string; type?: string; status?: string; post_id?: string | null };

      if (postData.type === 'golf_round') {
        // Group post - refetch to get complete scorecard data. Navigation into
        // the round is the composer's job now (round-route), so this handler
        // only refreshes. The composer already showed a round-specific toast;
        // a second generic one on top of it was just noise.
        await loadFeed();
        setIsCreatePostModalOpen(false);
        return;
      }
      // Regular post - add immediately to top of feed
      setPosts(prevPosts => [newPost as Post, ...prevPosts]);
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
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
          <p className="mt-4 text-secondary font-medium">Loading your feed...</p>
          <p className="mt-1 text-sm text-muted">Getting everything ready</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Unified Header */}
      <AppHeader
        showSearch={true}
        onCreatePost={() => setIsCreatePostModalOpen(true)}
        onEditProfile={() => setIsEditProfileModalOpen(true)}
      />

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* md: two columns from 768px — the whole tablet band used to stack
            the sidebar (suggestions, calendar, club) BELOW the entire
            paginated feed, where nobody ever saw it. */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-6">
          {/* Main Content */}
          <div className="md:col-span-7 lg:col-span-8">
            {/* Post Creation Form */}
            <div className="ea-surface rounded-xl p-3 sm:p-4 mb-4 sm:mb-6">
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
                  <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-semibold">
                      {getInitials(formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name))}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => setIsCreatePostModalOpen(true)}
                  className="ea-interactive flex-1 bg-surface-sunken rounded-lg px-3 sm:px-4 py-2.5 text-left text-muted text-sm sm:text-base"
                >
                  What&apos;s on your mind, {profile?.first_name || 'Athlete'}?
                </button>
              </div>
              {/* `py-3.5 -my-3.5` grows these from 16px tall to a 44px touch
                  target (Stats and Achievement are icon-only on phones, so they
                  were 20x16). The negative margin cancels the padding for
                  layout, so the row's height and spacing are unchanged — this
                  buys hit area, not visual weight. */}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-subtle">
                <div className="flex items-center gap-2 sm:gap-4">
                  <button onClick={() => setIsCreatePostModalOpen(true)} className="ea-interactive group flex items-center gap-1.5 sm:gap-2 rounded-lg px-2.5 py-3.5 -my-1 text-tertiary hover:text-primary">
                    <i className="fas fa-image text-faint transition-colors duration-[150ms] group-hover:text-green-600 dark:group-hover:text-green-400"></i>
                    <span className="text-xs sm:text-sm">Photo/Video</span>
                  </button>
                  <button onClick={() => setIsCreatePostModalOpen(true)} aria-label="Add stats to a post" className="ea-interactive group flex items-center gap-1.5 sm:gap-2 rounded-lg px-2.5 py-3.5 -my-1 text-tertiary hover:text-primary">
                    <i className="fas fa-chart-line text-faint transition-colors duration-[150ms] group-hover:text-brand-fg"></i>
                    <span className="text-xs sm:text-sm hidden sm:inline">Stats</span>
                  </button>
                  <button onClick={() => setIsCreatePostModalOpen(true)} aria-label="Add an achievement to a post" className="ea-interactive group flex items-center gap-1.5 sm:gap-2 rounded-lg px-2.5 py-3.5 -my-1 text-tertiary hover:text-primary">
                    <i className="fas fa-trophy text-faint transition-colors duration-[150ms] group-hover:text-amber-500"></i>
                    <span className="text-xs sm:text-sm hidden sm:inline">Achievement</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Live round resume banner */}
            {liveRound && !liveBannerDismissed && (
              <div className="mb-4 sm:mb-6 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg border-2 border-green-800 p-4 flex items-center gap-3 flex-wrap">
                <span className="w-2.5 h-2.5 bg-red-400 rounded-full animate-pulse flex-shrink-0" aria-hidden="true"></span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">
                    Live round{liveRound.course_name ? ` at ${liveRound.course_name}` : ''}
                  </div>
                  <div className="text-sm text-green-100">Pick up right where you left off</div>
                </div>
                <button
                  onClick={() => router.push(liveRoundPath(liveRound.group_post_id))}
                  className="bg-white text-green-700 font-bold px-4 py-2 rounded-lg hover:bg-green-50 transition-colors flex-shrink-0 min-h-[44px]"
                >
                  Continue scoring
                </button>
                <button
                  onClick={dismissLiveBanner}
                  className="text-green-100 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
                  aria-label="Dismiss live round banner"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            )}

            {/* Live Now — live rounds from people you follow (sports-app
                ticker; opens the round via the existing deep-link modal) */}
            <LiveNowStrip />

            {/* Posts Feed */}
            {/* No background or border of its own: each PostCard already draws
                    border-2 border-border-strong, and wrapping them in a box with
                    the SAME fill and the SAME border meant every card edge sat on
                    an identical edge — so nothing read as a card. Letting them sit
                    on the page canvas is what makes the border visible, and it
                    applies to every post equally. */}
            <div className="space-y-4 sm:space-y-6">
              {feedLoading ? (
                <div className="space-y-6">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-surface rounded-lg shadow-md border-2 border-border-strong p-4 animate-pulse mb-6">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-gray-200 dark:bg-stone-800 rounded-full"></div>
                        <div className="flex-1">
                          <div className="h-4 bg-gray-200 dark:bg-stone-800 rounded w-24 mb-1"></div>
                          <div className="h-3 bg-gray-200 dark:bg-stone-800 rounded w-16"></div>
                        </div>
                      </div>
                      <div className="aspect-video bg-gray-200 dark:bg-stone-800 rounded-lg mb-4"></div>
                      <div className="h-4 bg-gray-200 dark:bg-stone-800 rounded w-3/4"></div>
                    </div>
                  ))}
                </div>
              ) : posts.length === 0 ? (
                <div className="bg-surface rounded-lg shadow-md border-2 border-border-strong p-8 text-center">
                  {/* Empty state follows the athlete's declared sport; fully
                      neutral when none is set */}
                  <div className={`mb-4 ${profileDefaultSport ? 'text-green-500' : 'text-violet-500'}`}>
                    <i className={`${profileDefaultSport ? getSportDefinition(profileDefaultSport).icon_id : 'fas fa-users'} text-4xl`}></i>
                  </div>
                  <h3 className="text-lg font-medium text-primary mb-2">
                    {profileDefaultSport
                      ? getEmptyStateMessage(profileDefaultSport)
                      : 'Your feed starts with your first post'}
                  </h3>
                  <p className="text-tertiary mb-6">
                    {profileDefaultSport
                      ? getActivityEncouragement(profileDefaultSport)
                      : 'Share what you’re working on.'}{' '}
                    Following other athletes fills this feed up too.
                  </p>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                    <button
                      onClick={() => setIsCreatePostModalOpen(true)}
                      className="w-full sm:w-auto bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors font-medium"
                    >
                      {profileDefaultSport ? (
                        <>
                          <i className={`${getSportDefinition(profileDefaultSport).icon_id} mr-2`}></i>
                          {COPY.SPORT_ACTIONS.PRIMARY_ACTION(profileDefaultSport)}
                        </>
                      ) : (
                        <>
                          <i className="fas fa-plus mr-2"></i>
                          Create your first post
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setIsCreatePostModalOpen(true)}
                      className="w-full sm:w-auto bg-surface-sunken text-secondary px-6 py-3 rounded-lg hover:bg-gray-200 dark:hover:bg-stone-800 transition-colors font-medium"
                    >
                      Create a post
                    </button>
                  </div>
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
                      onReposted={(created) => {
                        const repost = created as Post;
                        setPosts(prev =>
                          prev.some(p => p.id === repost.id) ? prev : [repost, ...prev]
                        );
                      }}
                    />
                  ))}
                  
                  {hasMore && (
                    <div className="text-center py-4">
                      <button
                        onClick={() => loadFeed(true)}
                        className="bg-surface text-brand-fg border border-brand px-6 py-2 min-h-[44px] rounded-lg hover:bg-brand-soft transition-colors font-medium"
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
          <div className="md:col-span-5 lg:col-span-4 space-y-6">
            {/* Connection Suggestions */}
            {user && (
              <ConnectionSuggestions profileId={user.id} limit={5} compact={true} />
            )}

            {/* Upcoming Events — real calendar widget when the flag is on;
                the coming-soon shell otherwise (prod unchanged). */}
            {FEATURE_FLAGS.FEATURE_CALENDAR && user ? (
              <FeedCalendarWidget />
            ) : (
              <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-primary">Upcoming Events</h3>
                </div>
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <div className="w-10 h-10 bg-brand-soft rounded-full flex items-center justify-center mb-3">
                    <i className="fas fa-calendar-days text-violet-400 text-lg"></i>
                  </div>
                  <p className="text-sm font-medium text-secondary mb-1">No upcoming events</p>
                  <p className="text-xs text-faint">Tournament and event scheduling is coming soon.</p>
                </div>
              </div>
            )}

            {/* Your Club */}
            <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-primary">Your Club</h3>
              </div>
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="w-10 h-10 bg-green-50 dark:bg-green-950/40 rounded-full flex items-center justify-center mb-3">
                  <i className="fas fa-flag text-green-400 text-lg"></i>
                </div>
                <p className="text-sm font-medium text-secondary mb-1">No club linked</p>
                <p className="text-xs text-faint">Club and team management is coming soon.</p>
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
        defaultSportKey={deepLinkSport ?? profileDefaultSport ?? 'general'}
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

      {/* Search-result deep link (/feed?post=) */}
      <Suspense fallback={null}>
        <PostParamReader onPost={setDeepLinkPostId} />
      </Suspense>
      {deepLinkPostId && (
        <PostDetailModal
          postId={deepLinkPostId}
          isOpen={true}
          onClose={() => {
            setDeepLinkPostId(null);
            window.history.replaceState(null, '', '/feed');
          }}
          currentUserId={user?.id}
          // End Round lands here (/feed?post=). Without onDelete the trash
          // used to render and silently no-op — the "delete after end round
          // won't let me" bug. Reuses the list's handler, then closes.
          onDelete={(postId) => {
            handleDelete(postId);
            setDeepLinkPostId(null);
            window.history.replaceState(null, '', '/feed');
          }}
        />
      )}

      {/* Edit Profile Modal */}
      <EditProfileTabs
        isOpen={isEditProfileModalOpen}
        onClose={() => setIsEditProfileModalOpen(false)}
        profile={profile}
        onSave={() => {
          // Profile will be refreshed automatically by useAuth
          setIsEditProfileModalOpen(false);
        }}
      />

      {/* Toast Container */}
    </div>
  );
}