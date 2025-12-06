'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Camera, BarChart3, Tag, Dumbbell, Activity, Trophy } from 'lucide-react';
import OptimizedImage from './OptimizedImage';
import PostDetailModal from './PostDetailModal';
import EditPostModal from './EditPostModal';
import EquipmentSection from './EquipmentSection';
import { useToast } from './Toast';
import { formatGolfStatsSummary, formatGenericStatsSummary } from '@/lib/stats-summary';

type TabType = 'all' | 'stats' | 'tagged' | 'equipment' | 'vitals' | 'achievements';
type SortType = 'newest' | 'most_engaged';
type MediaFilterType = 'all' | 'photos' | 'videos' | 'posts';

interface MediaItem {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: Record<string, unknown> | null;
  round_id?: string | null;
  visibility: string;
  created_at: string;
  profile_id: string;
  profile_first_name: string | null;
  profile_last_name: string | null;
  profile_full_name: string | null;
  profile_avatar_url: string | null;
  media_count: number;
  likes_count: number;
  comments_count: number;
  saves_count: number;
  tags?: string[] | null;
  hashtags?: string[] | null;
  is_own_post: boolean;
  is_tagged: boolean;
  media?: Array<{
    id: string;
    media_url: string;
    media_type: 'image' | 'video';
    display_order: number;
  }>;
  golf_round?: {
    id: string;
    course: string | null;
    course_location: string | null;
    gross_score: number | null;  // Changed from total_score
    par: number | null;
    holes: number | null;
    gir_percentage?: number | null;
    fir_percentage?: number | null;
    total_putts?: number | null;
  } | null;
}

interface TabCounts {
  all: number;
  stats: number;
  tagged: number;
  equipment: number;
  vitals: number;
  achievements: number;
}

interface ProfileMediaTabsProps {
  profileId: string;
  currentUserId?: string;
  isOwnProfile?: boolean;
  onCountsChange?: (counts: TabCounts) => void;
}

export default function ProfileMediaTabs({ profileId, currentUserId, isOwnProfile = false, onCountsChange }: ProfileMediaTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [sort, setSort] = useState<SortType>('newest');
  const [mediaFilter, setMediaFilter] = useState<MediaFilterType>('all');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [counts, setCounts] = useState<TabCounts>({ all: 0, stats: 0, tagged: 0, equipment: 0, vitals: 0, achievements: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [, setOffset] = useState(0);
  const observerTarget = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0); // Use ref for offset to avoid dependency issues

  // Modal state
  const [selectedPostIndex, setSelectedPostIndex] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditPostModalOpen, setIsEditPostModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<MediaItem | null>(null);

  // Toast notifications
  const { showSuccess, showError } = useToast();

  // Fetch counts for tab badges
  const fetchCounts = useCallback(async () => {
    try {
      const response = await fetch(`/api/profile/${profileId}/media`, {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        setCounts(data);
        // Notify parent component of count changes
        if (onCountsChange) {
          onCountsChange(data);
        }
      }
    } catch {
      // Silently handle media count fetch errors
    }
  }, [profileId, onCountsChange]);

  // Fetch media items
  const fetchMedia = useCallback(async (resetItems = false) => {
    try {
      if (resetItems) {
        setLoading(true);
        setOffset(0);
        offsetRef.current = 0;
      } else {
        setLoadingMore(true);
      }

      const currentOffset = resetItems ? 0 : offsetRef.current;
      const params = new URLSearchParams({
        tab: activeTab,
        sort,
        mediaType: mediaFilter,
        limit: '20',
        offset: currentOffset.toString()
      });

      const response = await fetch(`/api/profile/${profileId}/media?${params}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch media: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      if (resetItems) {
        setItems(data.items || []);
      } else {
        setItems(prev => [...prev, ...(data.items || [])]);
      }

      setHasMore(data.hasMore || false);
      const newOffset = data.nextOffset || currentOffset + (data.items?.length || 0);
      setOffset(newOffset);
      offsetRef.current = newOffset;
    } catch {
      // Reset loading states on error
      setLoading(false);
      setLoadingMore(false);
      // Show empty state on error
      if (resetItems) {
        setItems([]);
        setHasMore(false);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [profileId, activeTab, sort, mediaFilter]);

  // Load counts on mount and when profileId changes
  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Load media when tab/filter/sort/profileId changes
  useEffect(() => {
    fetchMedia(true);
  }, [activeTab, sort, mediaFilter, profileId, fetchMedia]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          fetchMedia(false);
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, loadingMore, fetchMedia]);

  const handleItemClick = (index: number) => {
    setSelectedPostIndex(index);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedPostIndex(null);
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (selectedPostIndex === null) return;

    if (direction === 'prev' && selectedPostIndex > 0) {
      setSelectedPostIndex(selectedPostIndex - 1);
    } else if (direction === 'next' && selectedPostIndex < items.length - 1) {
      setSelectedPostIndex(selectedPostIndex + 1);
    }
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setItems([]);
    setOffset(0);
    setSelectedPostIndex(null);
    setIsModalOpen(false);
  };

  const handleEdit = async (postId: string) => {
    try {
      // Fetch full post data for editing
      const response = await fetch(`/api/posts?postId=${postId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch post');
      }
      const data = await response.json();
      setEditingPost(data.post);
      setIsEditPostModalOpen(true);
      setIsModalOpen(false); // Close detail modal
    } catch {
      showError('Error', 'Failed to load post for editing');
    }
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
      setItems(prevItems => prevItems.filter(item => item.id !== postId));

      // Close modals
      setIsModalOpen(false);
      setSelectedPostIndex(null);

      // Refresh counts
      fetchCounts();

      showSuccess('Success', 'Post deleted successfully');
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Failed to delete post');
    }
  };

  const handlePostUpdated = () => {
    // Refresh media when a post is updated
    fetchMedia(true);
    fetchCounts();
    setIsEditPostModalOpen(false);
    setEditingPost(null);
    showSuccess('Success', 'Post updated successfully!');
  };

  // Tab configuration with icons
  const tabs = [
    { id: 'all' as TabType, label: 'Media', icon: Camera, count: counts.all },
    { id: 'stats' as TabType, label: 'Stats', icon: BarChart3, count: counts.stats },
    { id: 'tagged' as TabType, label: 'Tagged', icon: Tag, count: counts.tagged },
    { id: 'equipment' as TabType, label: 'Equipment', icon: Dumbbell, count: counts.equipment },
    { id: 'vitals' as TabType, label: 'Vitals', icon: Activity, count: counts.vitals },
    { id: 'achievements' as TabType, label: 'Achievements', icon: Trophy, count: counts.achievements },
  ];

  return (
    <div className="w-full space-y-6">
      {/* Modern Segmented Control Tabs */}
      <div className="relative">
        {/* Scrollable container with gradient fade on edges */}
        <div className="relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none md:hidden" />
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none md:hidden" />

          <div className="overflow-x-auto scrollbar-hide">
            <nav
              className="flex gap-2 p-1 bg-gray-100 rounded-xl min-w-min"
              aria-label="Profile sections"
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`
                      relative flex items-center gap-2 px-4 py-2.5 rounded-lg
                      font-semibold text-sm transition-all duration-200
                      whitespace-nowrap flex-shrink-0
                      ${isActive
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50/50'
                      }
                    `}
                  >
                    {/* Icon */}
                    <Icon
                      className={`w-4 h-4 transition-colors ${
                        isActive ? 'text-blue-600' : 'text-gray-500'
                      }`}
                    />

                    {/* Label */}
                    <span>{tab.label}</span>

                    {/* Count badge */}
                    {tab.count > 0 && (
                      <span className={`
                        inline-flex items-center justify-center
                        min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold
                        transition-colors
                        ${isActive
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-700'
                        }
                      `}>
                        {tab.count > 99 ? '99+' : tab.count}
                      </span>
                    )}

                    {/* Active indicator dot (for new/unread items - future feature) */}
                    {tab.id === 'tagged' && tab.count > 0 && !isActive && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border-2 border-white" />
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </div>

      {/* Equipment Section (special tab) */}
      {activeTab === 'equipment' && (
        <EquipmentSection profileId={profileId} isOwnProfile={isOwnProfile} />
      )}

      {/* Vitals and Achievements tabs (coming soon) */}
      {(activeTab === 'vitals' || activeTab === 'achievements') && (
        <div className="text-center py-16 px-4">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gray-100 flex items-center justify-center">
            {activeTab === 'vitals' && <Activity className="w-10 h-10 text-gray-400" />}
            {activeTab === 'achievements' && <Trophy className="w-10 h-10 text-gray-400" />}
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            {activeTab === 'vitals' && 'Vitals Tracking'}
            {activeTab === 'achievements' && 'Achievements'}
          </h3>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            This feature is coming soon! Track your progress and showcase your accomplishments.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg font-semibold text-sm">
            <Trophy className="w-4 h-4" />
            Feature in Development
          </div>
        </div>
      )}

      {/* Media/Stats/Tagged tabs */}
      {(activeTab === 'all' || activeTab === 'stats' || activeTab === 'tagged') && (
        <>
          {/* Filters (only shown for media/stats/tagged tabs) */}
          {(activeTab === 'all' || activeTab === 'stats' || activeTab === 'tagged') && (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                {/* Sort dropdown */}
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortType)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="newest">Newest First</option>
                  <option value="most_engaged">Most Engaged</option>
                </select>

                {/* Media type filter */}
                <select
                  value={mediaFilter}
                  onChange={(e) => setMediaFilter(e.target.value as MediaFilterType)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Types</option>
                  <option value="photos">Photos Only</option>
                  <option value="videos">Videos Only</option>
                  <option value="posts">Posts Only</option>
                </select>
              </div>

              <div className="text-sm text-gray-600">
                {items.length} {items.length === 1 ? 'item' : 'items'}
              </div>
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}

          {/* Empty state */}
          {!loading && items.length === 0 && (
        <div className="text-center py-16 px-4">
          {/* Icon based on tab type */}
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gray-100 flex items-center justify-center">
            {activeTab === 'all' && <Camera className="w-10 h-10 text-gray-400" />}
            {activeTab === 'stats' && <BarChart3 className="w-10 h-10 text-gray-400" />}
            {activeTab === 'tagged' && <Tag className="w-10 h-10 text-gray-400" />}
          </div>

          <h3 className="text-xl font-bold text-gray-900 mb-2">
            {activeTab === 'all' && 'No media yet'}
            {activeTab === 'stats' && 'No performance stats'}
            {activeTab === 'tagged' && 'No tags yet'}
          </h3>

          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            {activeTab === 'all' && isOwnProfile && 'Start sharing your athletic journey with photos, videos, and stats'}
            {activeTab === 'all' && !isOwnProfile && 'This athlete hasn\'t posted any content yet'}
            {activeTab === 'stats' && isOwnProfile && 'Add performance stats to your posts to track your progress over time'}
            {activeTab === 'stats' && !isOwnProfile && 'No performance statistics available for this athlete'}
            {activeTab === 'tagged' && isOwnProfile && 'You haven\'t been tagged in any posts yet'}
            {activeTab === 'tagged' && !isOwnProfile && 'This athlete hasn\'t been tagged in any posts'}
          </p>
          </div>
          )}

          {/* Media grid */}
          {!loading && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {items.map((item, index) => (
            <MediaGridItem
              key={item.id}
              item={item}
              onClick={() => handleItemClick(index)}
            />
          ))}
        </div>
      )}

          {/* Loading more indicator */}
          {loadingMore && (
            <div className="flex justify-center items-center py-6">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          )}

          {/* Intersection observer target */}
          <div ref={observerTarget} className="h-4" />
        </>
      )}

      {/* Post Detail Modal */}
      <PostDetailModal
        postId={selectedPostIndex !== null ? items[selectedPostIndex]?.id : null}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onNavigate={handleNavigate}
        currentUserId={currentUserId}
        showNavigation={items.length > 1}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      {/* Edit Post Modal */}
      {editingPost && (
        <EditPostModal
          isOpen={isEditPostModalOpen}
          onClose={() => {
            setIsEditPostModalOpen(false);
            setEditingPost(null);
          }}
          post={{
            ...editingPost,
            tags: editingPost.tags ?? undefined,
            hashtags: editingPost.hashtags ?? undefined
          } as Parameters<typeof EditPostModal>[0]['post']}
          onPostUpdated={handlePostUpdated}
        />
      )}
    </div>
  );
}

// Media grid item component
interface MediaGridItemProps {
  item: MediaItem;
  onClick: () => void;
}

function MediaGridItem({ item, onClick }: MediaGridItemProps) {
  const hasStats = item.stats_data && Object.keys(item.stats_data).length > 0;
  const hasMedia = item.media && item.media.length > 0;
  const firstMedia = hasMedia ? item.media![0] : null;
  const isVideo = firstMedia?.media_type === 'video';
  const mediaCount = item.media_count;

  // Determine content to display for non-media tiles
  const getTextContent = () => {
    // If has caption, show that
    if (item.caption) {
      return item.caption;
    }

    // If stats-only (no caption, no media), show stats summary
    if (hasStats || item.golf_round) {
      // Try golf round first
      if (item.golf_round) {
        const summary = formatGolfStatsSummary(item.golf_round);
        if (summary) {
          return (
            <div className="flex flex-col h-full justify-between p-3">
              {/* Golf icon badge */}
              <div className="flex justify-center mb-2">
                <div className="w-12 h-12 rounded-full bg-green-600 flex items-center justify-center shadow-md">
                  <i className="fas fa-golf-ball text-white text-xl"></i>
                </div>
              </div>

              {/* Score card */}
              <div className="bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-sm border border-green-200">
                <div className="text-center">
                  <div className="text-sm font-bold text-gray-900 line-clamp-2 mb-1">
                    {summary.primaryLine}
                  </div>
                  {summary.secondaryLine && (
                    <div className="text-xs text-green-700 font-semibold line-clamp-1">
                      {summary.secondaryLine}
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom accent */}
              <div className="mt-2 flex justify-center">
                <div className="h-1 w-16 bg-green-600 rounded-full"></div>
              </div>
            </div>
          );
        }
      }

      // Fall back to generic stats
      if (item.stats_data) {
        const summary = formatGenericStatsSummary(item.stats_data);
        if (summary) {
          return (
            <div className="flex flex-col h-full justify-between p-3">
              {/* Generic stats icon */}
              <div className="flex justify-center mb-2">
                <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center shadow-md">
                  <i className="fas fa-chart-line text-white text-xl"></i>
                </div>
              </div>

              {/* Stats card */}
              <div className="bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-sm border border-blue-200">
                <div className="text-center">
                  <div className="text-sm font-bold text-gray-900 line-clamp-2 mb-1">
                    {summary.primaryLine}
                  </div>
                  {summary.secondaryLine && (
                    <div className="text-xs text-blue-700 font-semibold line-clamp-1">
                      {summary.secondaryLine}
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom accent */}
              <div className="mt-2 flex justify-center">
                <div className="h-1 w-16 bg-blue-600 rounded-full"></div>
              </div>
            </div>
          );
        }
      }
    }

    // Final fallback
    return 'Post';
  };

  return (
    <button
      onClick={onClick}
      className={`relative aspect-square rounded-xl overflow-hidden transition-all duration-300 group ${
        item.golf_round
          ? 'bg-gray-100 hover:shadow-xl hover:shadow-green-200/50 hover:scale-105 ring-2 ring-green-100'
          : hasStats
          ? 'bg-gray-100 hover:shadow-xl hover:shadow-blue-200/50 hover:scale-105 ring-2 ring-blue-100'
          : 'bg-gray-100 hover:shadow-lg hover:scale-105'
      }`}
    >
      {/* Media thumbnail */}
      {hasMedia && firstMedia ? (
        <div className="w-full h-full">
          {isVideo ? (
            <div className="relative w-full h-full">
              <video
                src={firstMedia.media_url}
                className="w-full h-full object-cover"
                preload="metadata"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
                  <i className="fas fa-play text-white text-lg ml-1"></i>
                </div>
              </div>
            </div>
          ) : (
            <OptimizedImage
              src={firstMedia.media_url}
              alt={item.caption || 'Media'}
              width={300}
              height={300}
              className="w-full h-full object-cover"
            />
          )}
        </div>
      ) : (
        // Text/stats post (no media)
        <div className={`w-full h-full flex items-center justify-center ${
          item.golf_round
            ? 'bg-gradient-to-br from-green-50 via-emerald-50 to-green-100'
            : hasStats
            ? 'bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100'
            : 'bg-gradient-to-br from-gray-50 to-gray-100'
        }`}>
          <div className="text-center w-full">
            {typeof getTextContent() === 'string' ? (
              <p className="text-sm text-gray-700 line-clamp-4 px-4">
                {getTextContent()}
              </p>
            ) : (
              getTextContent()
            )}
          </div>
        </div>
      )}

      {/* Overlay with indicators */}
      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all">
        {/* Top indicators */}
        <div className="absolute top-2 right-2 flex gap-1">
          {hasStats && (
            <span className="px-2 py-1 bg-blue-600 text-white text-xs font-semibold rounded-full">
              + Stats
            </span>
          )}
          {mediaCount > 1 && (
            <span className="px-2 py-1 bg-black bg-opacity-60 text-white text-xs font-semibold rounded-full">
              <i className="fas fa-layer-group mr-1"></i>
              {mediaCount}
            </span>
          )}
        </div>

        {/* Bottom info on hover */}
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex items-center justify-between text-white text-xs">
            <div className="flex items-center gap-2">
              <span>
                <i className="fas fa-heart mr-1"></i>
                {item.likes_count}
              </span>
              <span>
                <i className="fas fa-comment mr-1"></i>
                {item.comments_count}
              </span>
            </div>
            <span className="text-gray-200">
              {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
            </span>
          </div>
        </div>
      </div>

      {/* Tagged indicator */}
      {item.is_tagged && !item.is_own_post && (
        <div className="absolute top-2 left-2">
          <span className="px-2 py-1 bg-green-600 text-white text-xs font-semibold rounded-full">
            <i className="fas fa-user-tag mr-1"></i>
            Tagged
          </span>
        </div>
      )}
    </button>
  );
}
