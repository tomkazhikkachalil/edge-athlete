'use client';

/**
 * The profile's Stats hub — the home for everything performance-related.
 *
 * Round 1 (extraction): renders exactly what the old ProfileMediaTabs
 * 'stats' branch rendered — filter row, stat-post grid, infinite scroll,
 * post detail/edit modals — but with its OWN state, fetched independently of
 * the Media tab. Extracted because ProfileMediaTabs had grown past 1000
 * lines and /u/[username] needs this hub WITHOUT the six-tab shell.
 * Later rounds add the sport-chip layers and per-sport breakdowns.
 */

import { useEffect, useRef, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import MediaGridItem, { type MediaItem } from '../media/MediaGridItem';
import PostDetailModal from '../PostDetailModal';
import EditPostModal from '../EditPostModal';
import SportYearFilter from '../SportYearFilter';
import FilterBar from '../filters/FilterBar';
import { useToast } from '../Toast';
import { getAllSports, SPORT_NAMES } from '@/lib/config/sports-config';

// Static filter catalogs — the dropdowns are aspirational (show the whole
// platform's sport list and a wide year range, not just what this athlete
// has posted). Picking a sport/year with no posts simply yields the empty
// state, which is acceptable.
const FILTER_START_YEAR = 2000;

const ALL_SPORT_KEYS: string[] = getAllSports()
  .slice()
  .sort((a, b) => (SPORT_NAMES[a] ?? a).localeCompare(SPORT_NAMES[b] ?? b));

const ALL_YEARS: number[] = (() => {
  const now = new Date().getFullYear();
  const years: number[] = [];
  for (let y = now; y >= FILTER_START_YEAR; y--) years.push(y);
  return years;
})();

type SortType = 'newest' | 'most_engaged';
type MediaFilterType = 'all' | 'photos' | 'videos' | 'posts';

interface StatsHubProps {
  profileId: string;
  currentUserId?: string;
  isOwnProfile?: boolean;
  /** Fires after a mutation here changes what the tab badges should show. */
  onCountsChanged?: () => void;
}

export default function StatsHub({
  profileId,
  currentUserId,
  isOwnProfile = false,
  onCountsChanged,
}: StatsHubProps) {
  const [sort, setSort] = useState<SortType>('newest');
  const [mediaFilter, setMediaFilter] = useState<MediaFilterType>('all');
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const observerTarget = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const requestSeqRef = useRef(0); // Guards against out-of-order responses (filter switches)

  // Modal state
  const [selectedPostIndex, setSelectedPostIndex] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditPostModalOpen, setIsEditPostModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<MediaItem | null>(null);

  const { showSuccess, showError } = useToast();

  // Paginated loader: defined inside the effect (clears the lint rule) and
  // published on a ref for the IntersectionObserver's load-more and the
  // post-mutation refresh. Same requestSeq/offset guards as the Media tab.
  const fetchMediaRef = useRef<(resetItems?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    const run = async (resetItems = false) => {
      const seq = ++requestSeqRef.current;
      try {
        if (resetItems) {
          setLoading(true);
          offsetRef.current = 0;
        } else {
          setLoadingMore(true);
        }

        const currentOffset = resetItems ? 0 : offsetRef.current;
        const params = new URLSearchParams({
          tab: 'stats',
          sort,
          mediaType: mediaFilter,
          limit: '20',
          offset: currentOffset.toString(),
        });
        if (selectedSports.length > 0) params.set('sportKeys', selectedSports.join(','));
        if (selectedYears.length > 0) params.set('years', selectedYears.join(','));

        const response = await fetch(`/api/profile/${profileId}/media?${params}`);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch media: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (seq !== requestSeqRef.current) return; // superseded

        if (resetItems) {
          setItems(data.items || []);
        } else {
          setItems(prev => [...prev, ...(data.items || [])]);
        }
        setHasMore(data.hasMore || false);
        offsetRef.current = data.nextOffset || currentOffset + (data.items?.length || 0);
      } catch (e) {
        console.error('Failed to fetch stats media:', e);
        if (seq !== requestSeqRef.current) return;
        if (resetItems) {
          setItems([]);
          setHasMore(false);
        }
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    };
    fetchMediaRef.current = run;
    run(true);
  }, [sort, mediaFilter, profileId, selectedSports, selectedYears]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          fetchMediaRef.current(false);
        }
      },
      { threshold: 0.1 }
    );
    const currentTarget = observerTarget.current;
    if (currentTarget) observer.observe(currentTarget);
    return () => {
      if (currentTarget) observer.unobserve(currentTarget);
    };
  }, [hasMore, loadingMore]);

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

  const handleEdit = async (postId: string) => {
    try {
      const response = await fetch(`/api/posts?postId=${postId}`);
      if (!response.ok) throw new Error('Failed to fetch post');
      const data = await response.json();
      setEditingPost(data.post);
      setIsEditPostModalOpen(true);
      setIsModalOpen(false);
    } catch (e) {
      console.error('Failed to fetch post for editing:', e);
      showError('Error', 'Failed to load post for editing');
    }
  };

  const handleDelete = async (postId: string) => {
    try {
      const response = await fetch(`/api/posts?postId=${postId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete post');
      }
      setItems(prevItems => prevItems.filter(item => item.id !== postId));
      setIsModalOpen(false);
      setSelectedPostIndex(null);
      onCountsChanged?.();
      showSuccess('Success', 'Post deleted successfully');
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Failed to delete post');
    }
  };

  const handlePostUpdated = () => {
    fetchMediaRef.current(true);
    onCountsChanged?.();
    setIsEditPostModalOpen(false);
    setEditingPost(null);
    showSuccess('Success', 'Post updated successfully!');
  };

  return (
    <div>
      {/* Filter rows — Sort + Media Type + Sport/Year in the shared FilterBar
          (controls + count pill + the active-filter strip with Clear all). */}
      <FilterBar
        resultCount={items.length}
        activeCount={selectedSports.length + selectedYears.length}
        onClearAll={() => {
          setSelectedSports([]);
          setSelectedYears([]);
        }}
      >
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortType)}
          className="px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="newest">Newest First</option>
          <option value="most_engaged">Most Engaged</option>
        </select>

        <select
          value={mediaFilter}
          onChange={e => setMediaFilter(e.target.value as MediaFilterType)}
          className="px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="all">All Types</option>
          <option value="photos">Photos Only</option>
          <option value="videos">Videos Only</option>
          <option value="posts">Posts Only</option>
        </select>

        <SportYearFilter
          availableSports={ALL_SPORT_KEYS}
          availableYears={ALL_YEARS}
          selectedSports={selectedSports}
          selectedYears={selectedYears}
          onSportsChange={setSelectedSports}
          onYearsChange={setSelectedYears}
        />
      </FilterBar>

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="text-center py-16 px-4">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-surface-sunken flex items-center justify-center">
            <BarChart3 className="w-10 h-10 text-faint" />
          </div>
          <h3 className="text-xl font-bold text-primary mb-2">No performance stats</h3>
          <p className="text-tertiary mb-6 max-w-md mx-auto">
            {isOwnProfile
              ? 'Add performance stats to your posts to track your progress over time'
              : 'No performance statistics available for this athlete'}
          </p>
        </div>
      )}

      {/* Stats grid */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {items.map((item, index) => (
            <MediaGridItem
              key={item.id}
              item={item}
              viewerId={currentUserId}
              onClick={() => {
                setSelectedPostIndex(index);
                setIsModalOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Loading more indicator */}
      {loadingMore && (
        <div className="flex justify-center items-center py-6">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand"></div>
        </div>
      )}

      {/* Intersection observer target */}
      <div ref={observerTarget} className="h-4" />

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
