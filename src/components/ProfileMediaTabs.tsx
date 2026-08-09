'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Camera, BarChart3, Tag, Dumbbell, Activity, Trophy } from 'lucide-react';
import OptimizedImage, { AvatarImage } from './OptimizedImage';
import PostDetailModal from './PostDetailModal';
import { buildStatHighlights, type StatPlayer } from '@/lib/sports/post-stat-highlights';
import { toParColorClass } from '@/lib/golf/scoring';
import { getInitials } from '@/lib/formatters';
import EditPostModal from './EditPostModal';
import EquipmentSection from './EquipmentSection';
import AchievementsTab from './AchievementsTab';
import TaggedTab from './TaggedTab';
import SportYearFilter from './SportYearFilter';
import FilterBar from './filters/FilterBar';
import { useToast } from './Toast';
import { formatGenericStatsSummary } from '@/lib/stats-summary';
import VitalsTab from './VitalsTab';
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

type TabType = 'all' | 'stats' | 'tagged' | 'equipment' | 'vitals' | 'achievements';
type SortType = 'newest' | 'most_engaged';
type MediaFilterType = 'all' | 'photos' | 'videos' | 'posts';

// Tabs backed by the media endpoint (/api/profile/[id]/media) FROM THIS
// component. The others (equipment, vitals, achievements, and now tagged —
// which fetches its own data inside TaggedTab) render their own components.
const MEDIA_TABS: TabType[] = ['all', 'stats'];
const isMediaTab = (t: TabType): boolean => MEDIA_TABS.includes(t);

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
  /** Shared (multi-player) rounds: course + who scored what. Absent from this
   *  endpoint until Aug 2026 — which is why those tiles used to show only a
   *  caption. Same shape as the feed's scorecard, so buildStatHighlights
   *  reads it unchanged. */
  group_scorecard?: Record<string, unknown> | null;
}

interface TabCounts {
  all: number;
  stats: number;
  tagged: number;
  equipment: number;
  vitals: number;
  achievements: number;
}

type MediaCountsResponse = TabCounts;

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
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [counts, setCounts] = useState<TabCounts>({ all: 0, stats: 0, tagged: 0, equipment: 0, vitals: 0, achievements: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [, setOffset] = useState(0);
  const observerTarget = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0); // Use ref for offset to avoid dependency issues
  const requestSeqRef = useRef(0); // Guards against out-of-order responses (tab/filter switches)

  // Modal state
  const [selectedPostIndex, setSelectedPostIndex] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditPostModalOpen, setIsEditPostModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<MediaItem | null>(null);

  // Toast notifications
  const { showSuccess, showError } = useToast();

  // Fetch counts for tab badges. Tab counts reflect the full profile and are
  // intentionally NOT affected by the sport/year filter selections, so badges
  // stay stable as users toggle filters.
  const fetchCounts = useCallback(async () => {
    try {
      const response = await fetch(`/api/profile/${profileId}/media`, {
        method: 'POST'
      });

      if (response.ok) {
        const data: MediaCountsResponse = await response.json();
        const tabCounts: TabCounts = {
          all: data.all,
          stats: data.stats,
          tagged: data.tagged,
          equipment: data.equipment ?? 0,
          vitals: data.vitals ?? 0,
          achievements: data.achievements ?? 0,
        };
        setCounts(tabCounts);
        if (onCountsChange) {
          onCountsChange(tabCounts);
        }
      } else {
        console.error('Failed to fetch media counts — status:', response.status);
      }
    } catch (e) {
      console.error('Failed to fetch media counts:', e);
    }
  }, [profileId, onCountsChange]);

  // Fetch media items
  const fetchMedia = useCallback(async (resetItems = false) => {
    // Sequence guard: if a newer fetch starts (fast tab/filter switching),
    // this one's response is ignored so it can't overwrite the grid with
    // stale data.
    const seq = ++requestSeqRef.current;
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
      if (selectedSports.length > 0) params.set('sportKeys', selectedSports.join(','));
      if (selectedYears.length > 0) params.set('years', selectedYears.join(','));

      const response = await fetch(`/api/profile/${profileId}/media?${params}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch media: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      // Ignore this response if a newer fetch has superseded it.
      if (seq !== requestSeqRef.current) return;

      if (resetItems) {
        setItems(data.items || []);
      } else {
        setItems(prev => [...prev, ...(data.items || [])]);
      }

      setHasMore(data.hasMore || false);
      const newOffset = data.nextOffset || currentOffset + (data.items?.length || 0);
      setOffset(newOffset);
      offsetRef.current = newOffset;
    } catch (e) {
      console.error('Failed to fetch profile media:', e);
      // Ignore stale errors — a newer fetch owns the UI now.
      if (seq !== requestSeqRef.current) return;
      // Show empty state on error
      if (resetItems) {
        setItems([]);
        setHasMore(false);
      }
    } finally {
      // Only the latest request controls the loading state.
      if (seq === requestSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [profileId, activeTab, sort, mediaFilter, selectedSports, selectedYears]);

  // Load counts on mount and when profileId changes
  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Load media when tab/filter/sort/profileId or sport/year filters change.
  // Only the media-backed tabs (all/stats/tagged) call the media endpoint;
  // equipment/vitals/achievements render their own components.
  useEffect(() => {
    if (!isMediaTab(activeTab)) return;
    fetchMedia(true);
  }, [activeTab, sort, mediaFilter, profileId, selectedSports, selectedYears, fetchMedia]);

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
    } catch (e) {
      console.error('Failed to fetch post for editing:', e);
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
              className="flex gap-2 p-1 bg-surface-sunken rounded-xl min-w-min"
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
                      relative flex min-h-[44px] items-center gap-2 px-4 py-2.5 rounded-lg
                      font-semibold text-sm transition-all duration-200
                      whitespace-nowrap flex-shrink-0
                      ${isActive
                        ? 'bg-surface text-primary shadow-sm'
                        : 'text-tertiary hover:text-primary hover:bg-surface-muted/50'
                      }
                    `}
                  >
                    {/* Icon */}
                    <Icon
                      className={`w-4 h-4 transition-colors ${
                        isActive ? 'text-brand-fg' : 'text-muted'
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
                          ? 'bg-brand text-white'
                          : 'bg-gray-200 dark:bg-stone-800 text-secondary'
                        }
                      `}>
                        {tab.count > 99 ? '99+' : tab.count}
                      </span>
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

      {/* Vitals tab */}
      {activeTab === 'vitals' && (
        <VitalsTab
          profileId={profileId}
          currentUserId={currentUserId}
          isOwnProfile={isOwnProfile}
        />
      )}

      {/* Achievements tab */}
      {activeTab === 'achievements' && (
        <AchievementsTab profileId={profileId} isOwnProfile={isOwnProfile} />
      )}

      {/* Tagged tab — its own dashboard (hero + real-data filters + grid) */}
      {activeTab === 'tagged' && (
        <TaggedTab
          profileId={profileId}
          currentUserId={currentUserId}
          isOwnProfile={isOwnProfile}
          onCountsChanged={fetchCounts}
        />
      )}

      {/* Media/Stats tabs */}
      {(activeTab === 'all' || activeTab === 'stats') && (
        <>
          {/* Filter rows — Sport + Year sit inline with Sort and Media Type,
              wrapped in the shared FilterBar (controls + count pill + the
              active-filter status strip with Clear all). */}
          <FilterBar
            resultCount={items.length}
            activeCount={selectedSports.length + selectedYears.length}
            onClearAll={() => {
              setSelectedSports([]);
              setSelectedYears([]);
            }}
          >
            {/* Sort dropdown */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortType)}
              className="px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="newest">Newest First</option>
              <option value="most_engaged">Most Engaged</option>
            </select>

            {/* Media type filter */}
            <select
              value={mediaFilter}
              onChange={(e) => setMediaFilter(e.target.value as MediaFilterType)}
              className="px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="all">All Types</option>
              <option value="photos">Photos Only</option>
              <option value="videos">Videos Only</option>
              <option value="posts">Posts Only</option>
            </select>

            {/* Sport + Year multi-select dropdowns — open to the full
                platform catalog, not just sports/years this athlete has
                posted in. */}
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
          {/* Icon based on tab type */}
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-surface-sunken flex items-center justify-center">
            {activeTab === 'all' && <Camera className="w-10 h-10 text-faint" />}
            {activeTab === 'stats' && <BarChart3 className="w-10 h-10 text-faint" />}
          </div>

          <h3 className="text-xl font-bold text-primary mb-2">
            {activeTab === 'all' && 'No media yet'}
            {activeTab === 'stats' && 'No performance stats'}
          </h3>

          <p className="text-tertiary mb-6 max-w-md mx-auto">
            {activeTab === 'all' && isOwnProfile && 'Start sharing your athletic journey with photos, videos, and stats'}
            {activeTab === 'all' && !isOwnProfile && 'This athlete hasn\'t posted any content yet'}
            {activeTab === 'stats' && isOwnProfile && 'Add performance stats to your posts to track your progress over time'}
            {activeTab === 'stats' && !isOwnProfile && 'No performance statistics available for this athlete'}
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
              viewerId={currentUserId}
              onClick={() => handleItemClick(index)}
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
/** Up to three faces, overlapped. Names never fit at 159px, so they are
 *  deliberately omitted — the avatars answer "who was there", the score row
 *  answers "how did it go". */
function TilePlayerStack({ players, onDark }: { players: StatPlayer[]; onDark?: boolean }) {
  if (players.length === 0) return null;
  return (
    <div className="flex -space-x-1.5">
      {players.slice(0, 3).map((p, i) => (
        <span
          key={p.profileId ?? `${p.name}-${i}`}
          className={`rounded-full ${onDark ? 'ring-1 ring-black/40' : 'ring-1 ring-surface'}`}
        >
          <AvatarImage src={p.avatarUrl} alt={p.name} size={18} fallbackInitials={getInitials(p.name)} />
        </span>
      ))}
      {players.length > 3 && (
        <span
          className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[9px] font-bold ${
            onDark ? 'bg-black/60 text-white ring-1 ring-black/40' : 'bg-surface-sunken text-tertiary ring-1 ring-surface'
          }`}
        >
          +{players.length - 3}
        </span>
      )}
    </div>
  );
}

interface MediaGridItemProps {
  item: MediaItem;
  /** Whose score to lead with, matching the expanded card. */
  viewerId?: string;
  onClick: () => void;
}

function MediaGridItem({ item, viewerId, onClick }: MediaGridItemProps) {
  const hasStats = item.stats_data && Object.keys(item.stats_data).length > 0;
  const hasMedia = item.media && item.media.length > 0;
  const firstMedia = hasMedia ? item.media![0] : null;
  const isVideo = firstMedia?.media_type === 'video';
  const mediaCount = item.media_count;

  // The SAME selector the expanded post card uses, so a tile and the card it
  // opens can never disagree about a round. Returns null when there is nothing
  // worth showing, which is the "draw no stat overlay" signal.
  const highlights = useMemo(
    () =>
      buildStatHighlights({
        sportKey: item.sport_key,
        statsData: item.stats_data,
        golfRound: item.golf_round,
        groupScorecard: item.group_scorecard,
        viewerId,
        author: {
          id: item.profile_id,
          first_name: item.profile_first_name,
          last_name: item.profile_last_name,
          full_name: item.profile_full_name,
          avatar_url: item.profile_avatar_url,
        },
      }),
    [item, viewerId]
  );
  const hasRound = !!item.golf_round || !!item.group_scorecard;
  const players = highlights?.players ?? [];

  // Determine content to display for non-media tiles.
  //
  // STATS BEFORE CAPTION, deliberately. This used to return `item.caption`
  // first, which meant the rich stat tiles below were unreachable for any post
  // that had a caption — i.e. nearly all of them ("Golf at Eagle Creek…"
  // rendered as prose where the score should be). A grid tile is the thing a
  // visitor clicks, so it has to lead with the number, not the sentence. The
  // caption is still the fallback for posts that have nothing else.
  const getTextContent = () => {
    // A ROUND: course, the number, and who played. Flat by necessity — the
    // previous treatment stacked a 48px puck, a padded card and an accent bar,
    // roughly 152px of fixed height inside a tile that is 159px at 390px wide.
    if (highlights && hasRound) {
      const toPar = highlights.heroToPar;
      return (
        /* The tile is a SQUARE that shrinks with the viewport — 159px at
           390px, but 152px at 375 and only 124px at 320 (two columns inside
           px-4 + p-4). This body was tuned at 390 and overflowed 48px at 320,
           and because the button is overflow-hidden it clipped silently at
           BOTH ends: the icon off the top, the players off the bottom. So the
           two decorative rows drop out as the tile gets smaller, in order of
           how little they carry: the icon first, then the faces. The course,
           the number and its label always survive. */
        <div className="flex h-full flex-col items-center justify-center gap-1 p-3">
          <span className="hidden min-[380px]:flex h-8 w-8 items-center justify-center rounded-full bg-green-600 shrink-0">
            <i className="fas fa-golf-ball text-white text-sm" aria-hidden="true"></i>
          </span>
          <div className="text-center min-w-0 w-full">
            <div className="text-[11px] font-bold text-primary line-clamp-2 leading-tight">
              {highlights.moment}
            </div>
            <div
              className={`text-2xl font-black leading-none tabular-nums mt-1 ${
                toPar !== undefined && toPar !== null ? toParColorClass(toPar) : 'text-primary'
              }`}
            >
              {highlights.hero.value}
            </div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-muted">
              {highlights.hero.label}
            </div>
            {(players.length > 0 || highlights.meta?.length) && (
              <div className="text-[10px] text-tertiary font-medium mt-0.5 truncate">
                {/* players[] is CREATION order now — the gross under the hero
                    must belong to the same athlete the hero describes
                    (viewer's row, else the leader), not whoever was entered
                    first. Same pick rule as buildPostHeadline. */}
                {[
                  players.length > 0
                    ? String(
                        (players.find(p => p.isViewer) ??
                          players.reduce((a, b) => (b.score < a.score ? b : a))).score
                      )
                    : null,
                  highlights.meta?.[0],
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
          </div>
          {players.length > 0 && (
            <div className="hidden min-[360px]:block">
              <TilePlayerStack players={players} />
            </div>
          )}
        </div>
      );
    }

    // Non-golf stat lines keep the schema-driven summary.
    if (hasStats && item.stats_data) {
      const summary = formatGenericStatsSummary(item.stats_data);
      if (summary) {
        return (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 p-3">
            {/* Dropped below 380px for the same reason as the golf branch, plus
                one of its own: this is the only body that also wears the
                "+ Stats" badge, and in a 124px tile the vertically-centred icon
                lands under it. The summary text carries the content; the icon
                is decoration. */}
            <span className="hidden min-[380px]:flex h-8 w-8 items-center justify-center rounded-full bg-brand shrink-0">
              <i className="fas fa-chart-line text-white text-sm" aria-hidden="true"></i>
            </span>
            <div className="text-center">
              <div className="text-[11px] font-bold text-primary line-clamp-2 leading-tight">
                {summary.primaryLine}
              </div>
              {summary.secondaryLine && (
                <div className="text-[10px] text-brand-fg-strong font-semibold line-clamp-1 mt-0.5">
                  {summary.secondaryLine}
                </div>
              )}
            </div>
          </div>
        );
      }
    }

    // Text-only posts: the caption IS the content.
    if (item.caption) {
      return item.caption;
    }

    // Final fallback
    return 'Post';
  };

  return (
    <button
      onClick={onClick}
      /* One edge for EVERY tile. This used to ring only golf/stats tiles, in
         pastels with no dark: variant — so in dark mode a stats tile wore a
         near-white halo and a plain tile wore nothing. */
      className="relative aspect-square rounded-xl overflow-hidden transition-all duration-300 group bg-surface-sunken border border-border hover:border-border-strong hover:shadow-lg hover:scale-105"
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
                <div className="w-12 h-12 bg-black/50 rounded-full flex items-center justify-center">
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
          hasRound
            ? 'bg-gradient-to-br from-green-50 via-emerald-50 to-green-100 dark:from-green-950/40 dark:via-emerald-950/40 dark:to-green-950/60'
            : hasStats
            ? 'bg-gradient-to-br from-violet-50 via-purple-50 to-violet-100 dark:from-violet-950/40 dark:via-purple-950/40 dark:to-violet-950/60'
            : 'bg-gradient-to-br from-gray-50 to-gray-100 dark:from-stone-900 dark:to-stone-800'
        }`}>
          <div className="text-center w-full">
            {typeof getTextContent() === 'string' ? (
              <p className="text-sm text-secondary line-clamp-4 px-4">
                {getTextContent()}
              </p>
            ) : (
              getTextContent()
            )}
          </div>
        </div>
      )}

      {/* Score band over a photo — MediaStatStrip at tile scale. The scrim is
          always painted because the photo underneath is whatever the athlete
          shot, and the band is always visible (not hover-gated) because the
          grid is mostly viewed on a phone. */}
      {hasMedia && highlights && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-2 pb-1.5 pt-6">
          <div className="flex items-end justify-between gap-1.5">
            <span className="min-w-0 truncate text-[10px] font-semibold text-white/90 drop-shadow">
              {highlights.moment}
            </span>
            <span className="shrink-0 text-lg font-black leading-none text-white drop-shadow tabular-nums">
              {highlights.hero.value}
            </span>
          </div>
          {players.length > 0 && (
            <div className="mt-1">
              <TilePlayerStack players={players} onDark />
            </div>
          )}
        </div>
      )}

      {/* Overlay with indicators */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all">
        {/* Top indicators */}
        <div className="absolute top-2 right-2 flex gap-1">
          {/* Not on golf tiles: the score band/stat body already says it, and
              two labels for one fact is noise at this size. */}
          {hasStats && !hasRound && (
            <span className="px-2 py-1 bg-brand text-white text-xs font-semibold rounded-full">
              + Stats
            </span>
          )}
          {mediaCount > 1 && (
            <span className="px-2 py-1 bg-black/60 text-white text-xs font-semibold rounded-full">
              <i className="fas fa-layer-group mr-1"></i>
              {mediaCount}
            </span>
          )}
        </div>

        {/* Bottom info: hover-revealed on fine pointers, ALWAYS visible on
            coarse ones — touch has no hover, so without pointer-coarse: this
            row simply did not exist on phones. Lifted above the score band
            when there is one — same nudge TaggedTile makes for its
            attribution strip. */}
        <div className={`absolute left-0 right-0 p-2 bg-gradient-to-t from-black to-transparent opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity ${
          hasMedia && highlights ? 'bottom-10' : 'bottom-0'
        }`}>
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
            {/* Counts always fit; the relative time does not — a 124px tile
                (two cols at 320px) can't hold "about 2 hours ago" beside
                them. Same width gate as the decorative rows above. */}
            <span className="text-gray-200 hidden min-[380px]:inline">
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
