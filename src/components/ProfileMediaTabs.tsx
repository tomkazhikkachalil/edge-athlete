'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, BarChart3, Tag, Dumbbell, Activity, Trophy } from 'lucide-react';
import PostDetailModal from './PostDetailModal';
import EditPostModal from './EditPostModal';
import EquipmentSection from './EquipmentSection';
import AchievementsTab from './AchievementsTab';
import TaggedTab from './TaggedTab';
import SportYearFilter from './SportYearFilter';
import FilterBar from './filters/FilterBar';
import MediaGridItem, { type MediaItem } from './media/MediaGridItem';
import StatsHub from './stats/StatsHub';
import type { SportSkillCard } from '@/lib/sports/server/types';
import { useToast } from './Toast';
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
// component. The others (stats — the StatsHub, with its own fetch state —
// plus equipment, vitals, achievements, and tagged) render their own
// components.
const MEDIA_TABS: TabType[] = ['all'];
const isMediaTab = (t: TabType): boolean => MEDIA_TABS.includes(t);

interface TabCounts {
  all: number;
  stats: number;
  tagged: number;
  /** Text-only posts (074) — no tab here; feeds the StatementsRail above. */
  statements: number;
  equipment: number;
  vitals: number;
  achievements: number;
}

type MediaCountsResponse = TabCounts;

const TAB_IDS: TabType[] = ['all', 'stats', 'tagged', 'equipment', 'vitals', 'achievements'];

/** `?tab=` values arrive from the URL, so anything unrecognised degrades to 'all'. */
export function parseProfileTab(value: string | null | undefined): TabType {
  return TAB_IDS.includes(value as TabType) ? (value as TabType) : 'all';
}

interface ProfileMediaTabsProps {
  profileId: string;
  currentUserId?: string;
  isOwnProfile?: boolean;
  onCountsChange?: (counts: TabCounts) => void;
  /** Deep-linked tab (`?tab=vitals`); validated, bad values fall back to 'all'. */
  initialTab?: string;
  /** Fires after a user-initiated tab switch — callers mirror it into the URL. */
  onTabChange?: (tab: TabType) => void;
  /** The athlete's skill cards — the Stats hub's sport chips. */
  skillCards?: SportSkillCard[];
  /** Deep-linked sport for the Stats hub (`?sport=`). */
  initialSport?: string | null;
  /** Fires on hub chip flips — callers mirror the sport into the URL. */
  onSportChange?: (sportKey: string | null) => void;
}

export default function ProfileMediaTabs({ profileId, currentUserId, isOwnProfile = false, onCountsChange, initialTab, onTabChange, skillCards, initialSport, onSportChange }: ProfileMediaTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>(() => parseProfileTab(initialTab));
  const [sort, setSort] = useState<SortType>('newest');
  const [mediaFilter, setMediaFilter] = useState<MediaFilterType>('all');
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [counts, setCounts] = useState<TabCounts>({ all: 0, stats: 0, tagged: 0, statements: 0, equipment: 0, vitals: 0, achievements: 0 });
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

  // Fetch media items

  // Counts loader lives inside the effect (that clears the lint rule) and is
  // published on a ref so the post-mutation refreshes and the child's
  // onCountsChanged callback can still trigger it.
  const fetchCountsRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const run = async () => {
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
              statements: data.statements ?? 0,
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
    };
    fetchCountsRef.current = run;
    run();
  }, [profileId, onCountsChange]);

  // Load media when tab/filter/sort/profileId or sport/year filters change.
  // Only the media-backed tabs (all/stats/tagged) call the media endpoint;
  // equipment/vitals/achievements render their own components.
  // Paginated loader: defined inside the effect (clears the lint rule) and
  // published on a ref for the IntersectionObserver's load-more and the
  // post-mutation refresh. It keeps its own requestSeqRef/offsetRef guards,
  // and re-publishing on every filter change means the observer always calls
  // the closure holding the CURRENT filters.
  const fetchMediaRef = useRef<(resetItems?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    const run = async (resetItems = false) => {
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
    };
    fetchMediaRef.current = run;
    if (!isMediaTab(activeTab)) return;
    run(true);
  }, [activeTab, sort, mediaFilter, profileId, selectedSports, selectedYears]);

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
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, loadingMore]);

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
    // Re-clicking the ALREADY-ACTIVE tab used to wipe the grid: setItems([])
    // ran, but activeTab never changed, so the fetch effect (keyed on it) did
    // not re-run and the empty state stuck until a tab switch or reload.
    if (tab === activeTab) return;
    setActiveTab(tab);
    setItems([]);
    setOffset(0);
    setSelectedPostIndex(null);
    setIsModalOpen(false);
    onTabChange?.(tab);
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
      fetchCountsRef.current();

      showSuccess('Success', 'Post deleted successfully');
    } catch (err) {
      showError('Error', err instanceof Error ? err.message : 'Failed to delete post');
    }
  };

  const handlePostUpdated = () => {
    // Refresh media when a post is updated
    fetchMediaRef.current(true);
    fetchCountsRef.current();
    setIsEditPostModalOpen(false);
    setEditingPost(null);
    showSuccess('Success', 'Post updated successfully!');
  };

  // Six tabs overflow a phone-width viewport and `scrollbar-hide` removes the
  // native hint, so fades mark whichever edge has more content — same pattern
  // as the settings page tab strip.
  const tabScrollerRef = useRef<HTMLDivElement>(null);
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });

  const measureTabOverflow = useCallback(() => {
    const scroller = tabScrollerRef.current;
    if (!scroller) return;
    // 1px slack: fractional scroll positions otherwise leave a fade pinned on.
    setTabOverflow({
      left: scroller.scrollLeft > 1,
      right: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const scroller = tabScrollerRef.current;
    if (!scroller) return;
    measureTabOverflow();
    scroller.addEventListener('scroll', measureTabOverflow, { passive: true });
    window.addEventListener('resize', measureTabOverflow);
    return () => {
      scroller.removeEventListener('scroll', measureTabOverflow);
      window.removeEventListener('resize', measureTabOverflow);
    };
  }, [measureTabOverflow]);

  // Keep the active tab visible inside the phone-width scroller — without this
  // a deep-linked `?tab=vitals` (5th of 6) selects a button that sits
  // off-screen and the page looks like the old design never loaded.
  useEffect(() => {
    const scroller = tabScrollerRef.current;
    if (!scroller) return;
    const btn = scroller.querySelector<HTMLElement>(`[data-tab="${activeTab}"]`);
    // block:'nearest' so the page never jumps vertically on mount.
    btn?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeTab]);

  // A ?tab= DEEP LINK must land the tab strip on screen from the URL alone —
  // nothing else scrolls the page vertically, so at phone width the strip
  // only appeared when the content above it happened to be short. Content
  // above and beside the strip (skill cards, featured posts, statements)
  // streams in after mount and shifts layout, so a single mount-time scroll
  // can land anywhere: hold the section pinned through the settle window,
  // releasing early on the first user input so we never fight a real scroll.
  const rootRef = useRef<HTMLDivElement>(null);
  const deepLinkedRef = useRef(parseProfileTab(initialTab) !== 'all');
  useEffect(() => {
    if (!deepLinkedRef.current) return;
    const root = rootRef.current;
    if (!root) return;
    let active = true;
    const pin = () => {
      if (active) root.scrollIntoView({ block: 'start' });
    };
    const stop = () => {
      active = false;
      observer.disconnect();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };
    const observer = new ResizeObserver(pin);
    pin();
    observer.observe(document.body);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    const timer = setTimeout(stop, 1600);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);

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
    // scroll-mt clears the sticky AppHeader when the deep-link pin scrolls
    // this section to the viewport top.
    <div ref={rootRef} className="w-full space-y-6 scroll-mt-20">
      {/* Modern Segmented Control Tabs */}
      <div className="relative">
        {/* Scrollable container with gradient fade on the edge that has more content */}
        <div className="relative overflow-hidden">
          {tabOverflow.left && (
            <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-surface to-transparent z-10 pointer-events-none md:hidden" />
          )}
          {tabOverflow.right && (
            <div aria-hidden="true" className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface to-transparent z-10 pointer-events-none md:hidden" />
          )}

          <div ref={tabScrollerRef} className="overflow-x-auto scrollbar-hide">
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
                    data-tab={tab.id}
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
          onCountsChanged={() => fetchCountsRef.current()}
        />
      )}

      {/* Stats tab — the performance hub, its own fetch/filter state */}
      {activeTab === 'stats' && (
        <StatsHub
          profileId={profileId}
          currentUserId={currentUserId}
          isOwnProfile={isOwnProfile}
          onCountsChanged={() => fetchCountsRef.current()}
          skillCards={skillCards}
          initialSport={initialSport}
          onSportChange={onSportChange}
        />
      )}

      {/* Media tab */}
      {activeTab === 'all' && (
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
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-surface-sunken flex items-center justify-center">
            <Camera className="w-10 h-10 text-faint" />
          </div>

          <h3 className="text-xl font-bold text-primary mb-2">No media yet</h3>

          <p className="text-tertiary mb-6 max-w-md mx-auto">
            {isOwnProfile
              ? 'Start sharing your athletic journey with photos, videos, and stats'
              : 'This athlete hasn\'t posted any content yet'}
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

