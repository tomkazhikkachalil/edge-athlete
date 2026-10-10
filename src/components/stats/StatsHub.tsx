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

import RivalsPanel from '@/components/play/RivalsPanel';
import { COPY } from '@/lib/copy';
import ChallengesPanel from '@/components/play/ChallengesPanel';
import { challengeMetrics } from '@/lib/play/challenges';
import { useEffect, useRef, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import MediaGridItem, { type MediaItem } from '../media/MediaGridItem';
import PostDetailModal from '../PostDetailModal';
import EditPostModal from '../EditPostModal';
import MultiSelectDropdown from '../filters/MultiSelectDropdown';
import FilterBar from '../filters/FilterBar';
import SportSkillCards from '../SportSkillCards';
import SportBreakdownHeader from './SportBreakdownHeader';
import GolfBreakdown from './GolfBreakdown';
import StatLineBreakdown from './StatLineBreakdown';
import TrackBreakdown from './TrackBreakdown';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { useToast } from '../Toast';
import { HIDDEN_NOTICE } from '@/lib/results/kinds';
import type { SportSkillCard } from '@/lib/sports/server/types';

// Aspirational year catalog (whole range, not just posted years) — same
// stance as the Media tab; an empty year simply yields the empty state.
const FILTER_START_YEAR = 2000;

const ALL_YEARS: number[] = (() => {
  const now = new Date().getFullYear();
  const years: number[] = [];
  for (let y = now; y >= FILTER_START_YEAR; y--) years.push(y);
  return years;
})();

type SortType = 'newest' | 'most_engaged';
type MediaFilterType = 'all' | 'photos' | 'videos' | 'posts';

/** `?sport=` arrives from the URL; anything not among the athlete's active
 *  sports degrades to null — the All layer. */
export function parseStatsSport(
  value: string | null | undefined,
  cards: SportSkillCard[] | undefined
): string | null {
  if (!value || !cards) return null;
  return cards.some(c => c.sportKey === value) ? value : null;
}

/** Search matches are computed over what the hub has LOADED. */
function matchesQuery(item: MediaItem, q: string, sportLabels: Map<string, string>): boolean {
  const needle = q.toLowerCase();
  if (item.caption?.toLowerCase().includes(needle)) return true;
  if (item.hashtags?.some(h => h.toLowerCase().includes(needle))) return true;
  if (item.tags?.some(t => t.toLowerCase().includes(needle))) return true;
  const label = item.sport_key ? sportLabels.get(item.sport_key) : undefined;
  if (label?.toLowerCase().includes(needle)) return true;
  return false;
}

// While a query is active, keep paging until the whole profile is loaded or
// this many items are in memory — client-side search must converge on the
// full set, not just the first page.
const SEARCH_FILL_CAP = 200;

interface StatsHubProps {
  profileId: string;
  currentUserId?: string;
  isOwnProfile?: boolean;
  /** Fires after a mutation here changes what the tab badges should show. */
  onCountsChanged?: () => void;
  /** The athlete's per-sport skill cards — the source of the sport chips.
   *  Absent/empty ⇒ no chip row, just the All grid. */
  skillCards?: SportSkillCard[];
  /** Deep-linked sport (`?sport=`); invalid values fall back to All. */
  initialSport?: string | null;
  /** Fires on chip flips — callers mirror the sport into the URL. */
  onSportChange?: (sportKey: string | null) => void;
}

export default function StatsHub({
  profileId,
  currentUserId,
  isOwnProfile = false,
  onCountsChanged,
  skillCards,
  initialSport,
  onSportChange,
}: StatsHubProps) {
  const [sort, setSort] = useState<SortType>('newest');
  const [mediaFilter, setMediaFilter] = useState<MediaFilterType>('all');
  const [selectedSport, setSelectedSport] = useState<string | null>(() =>
    parseStatsSport(initialSport, skillCards)
  );
  const [query, setQuery] = useState('');
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
        // tab=stats (Tom, Oct 4 2026): the Stats tab lists posts WITH DATA
        // only — a round, a shared round, a stat line, a vitals entry, a
        // shared workout or activity (migration 070's predicate; the Stats
        // badge counts the same set). A plain photo post belongs to Media
        // alone, whatever sport the composer stamped on it. This hub used to
        // read tab=all narrowed by sport ("every hockey clip together"),
        // which put every photo under the sport's chip and left the badge
        // and the grid disagreeing. A result's photos still show in Media:
        // Media = everything that is not a notion; Stats ⊂ Media.
        const params = new URLSearchParams({
          tab: 'stats',
          sort,
          mediaType: mediaFilter,
          limit: '20',
          offset: currentOffset.toString(),
        });
        if (selectedSport) params.set('sportKeys', selectedSport);
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
  }, [sort, mediaFilter, profileId, selectedSport, selectedYears]);

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

  // Search runs client-side over LOADED items, so while a query is active
  // keep paging (bounded) until the profile's set is in memory — otherwise
  // "search" would silently mean "search the first 20".
  useEffect(() => {
    if (!query.trim() || !hasMore || loading || loadingMore) return;
    if (items.length >= SEARCH_FILL_CAP) return;
    fetchMediaRef.current(false);
  }, [query, hasMore, loading, loadingMore, items.length]);

  const sportLabels = new Map((skillCards ?? []).map(c => [c.sportKey as string, c.sportLabel]));
  const trimmedQuery = query.trim();
  const visibleItems = trimmedQuery
    ? items.filter(item => matchesQuery(item, trimmedQuery, sportLabels))
    : items;

  const handleSportChip = (sportKey: string | null) => {
    if (sportKey === selectedSport) return;
    setSelectedSport(sportKey);
    setSelectedPostIndex(null);
    setIsModalOpen(false);
    onSportChange?.(sportKey);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedPostIndex(null);
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (selectedPostIndex === null) return;
    if (direction === 'prev' && selectedPostIndex > 0) {
      setSelectedPostIndex(selectedPostIndex - 1);
    } else if (direction === 'next' && selectedPostIndex < visibleItems.length - 1) {
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

  const handleDelete = async (postId: string, mode?: 'delete') => {
    try {
      const response = await fetch(`/api/posts?postId=${postId}${mode === 'delete' ? '&mode=delete' : ''}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete post');
      }
      // A result comes back hidden, not deleted (241): it stays on your own
      // grid, marked — and the toast says which happened.
      const body = await response.json().catch(() => ({}));
      setItems(prevItems => body.hidden
        ? prevItems.map(item => (item.id === postId ? { ...item, profile_hidden: true } : item))
        : prevItems.filter(item => item.id !== postId));
      setIsModalOpen(false);
      setSelectedPostIndex(null);
      onCountsChanged?.();
      if (body.hidden) showSuccess('Hidden from your profile', HIDDEN_NOTICE);
      else if (body.deleted) showSuccess(COPY.FORMS.DELETED_RESULT_TITLE, COPY.FORMS.DELETED_RESULT_BODY);
      else showSuccess('Success', 'Post deleted successfully');
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

  const activeSportLabel = selectedSport ? sportLabels.get(selectedSport) ?? selectedSport : null;

  return (
    <div data-testid="stats-hub">
      {/* Layered navigation: All + one chip per sport the athlete plays —
          flipping between sports is one tap, no menus (explore-page chip
          pattern). Chips are NAVIGATION, so they sit above the FilterBar and
          are not part of its clear-all. */}
      {(skillCards?.length ?? 0) > 0 && (
        <div
          className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-4 -mx-4 px-4 sm:mx-0 sm:px-0"
          role="tablist"
          aria-label="Sport"
        >
          <button
            role="tab"
            aria-selected={selectedSport === null}
            onClick={() => handleSportChip(null)}
            className={`shrink-0 min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              selectedSport === null
                ? 'bg-brand text-white border-brand'
                : 'bg-surface text-secondary border-border-strong hover:bg-surface-sunken'
            }`}
          >
            All Sports
          </button>
          {(skillCards ?? []).map(card => (
            <button
              key={card.sportKey}
              role="tab"
              aria-selected={selectedSport === card.sportKey}
              onClick={() => handleSportChip(card.sportKey)}
              className={`shrink-0 min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                selectedSport === card.sportKey
                  ? 'bg-brand text-white border-brand'
                  : 'bg-surface text-secondary border-border-strong hover:bg-surface-sunken'
              }`}
            >
              {card.sportLabel}
            </button>
          ))}
        </div>
      )}

      {/* Sport layer: the compact expandable breakdown header — the short
          intro on top; the media grid below stays the bigger presence. */}
      {selectedSport && (() => {
        const card = (skillCards ?? []).find(c => c.sportKey === selectedSport);
        if (!card) return null;
        // Every sport with data gets a full breakdown: golf → embedded
        // trends; track → PB table + race log; other stat-line sports →
        // season totals + game log.
        const breakdown =
          card.sportKey === 'golf' ? (
            <GolfBreakdown profileId={profileId} />
          ) : card.sportKey === 'track_field' ? (
            <TrackBreakdown profileId={profileId} card={card} />
          ) : getStatSchema(card.sportKey as SportKey) ? (
            <StatLineBreakdown profileId={profileId} sportKey={card.sportKey as SportKey} />
          ) : undefined;
        return (
          <>
            <SportBreakdownHeader card={card}>{breakdown}</SportBreakdownHeader>
            {/* Play (244): head-to-head in this sport — the athlete chooses what shows. */}
            <RivalsPanel profileId={profileId} sportKey={card.sportKey} />
            {/* Play (244): friend challenges — the athlete's own, never shown to visitors. */}
            {isOwnProfile && challengeMetrics(card.sportKey).length > 0 && <ChallengesPanel sportKey={card.sportKey} />}
          </>
        );
      })()}

      {/* Play (244): the athlete's challenges across sports — a challenge in a
          sport with no layer yet (no results there) still lands here. */}
      {!selectedSport && isOwnProfile && <ChallengesPanel sportKey={null} />}

      {/* All layer: the per-sport summary intros above the combined grid. */}
      {!selectedSport && (skillCards?.length ?? 0) > 0 && (
        <div className="mb-4">
          <SportSkillCards
            profileId={profileId}
            isOwner={false}
            initialCards={skillCards}
            sectionId="stats-hub-sports"
          />
        </div>
      )}

      {/* Filter row — search + sort + media type + years in the shared
          FilterBar (controls + count pill + Clear all strip). The bar and
          the results under it share ONE spaced stack (TaggedTab's and
          AchievementsTab's shape): without it the strip sat flush on the
          grid — this root has no space-y of its own. */}
      <div className="space-y-6" data-stats-results="">
      <FilterBar
        resultCount={visibleItems.length}
        activeCount={selectedYears.length + (trimmedQuery ? 1 : 0)}
        onClearAll={() => {
          setSelectedYears([]);
          setQuery('');
        }}
      >
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search captions, tags…"
          aria-label="Search this athlete's media and stats"
          className="px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 min-w-0 w-44"
        />

        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortType)}
          aria-label="Sort"
          className="px-3 py-2 border border-border-strong rounded-lg text-sm"
        >
          <option value="newest">Newest First</option>
          <option value="most_engaged">Most Engaged</option>
        </select>

        <select
          value={mediaFilter}
          onChange={e => setMediaFilter(e.target.value as MediaFilterType)}
          aria-label="Media type"
          className="px-3 py-2 border border-border-strong rounded-lg text-sm"
        >
          <option value="all">All Types</option>
          <option value="photos">Photos Only</option>
          <option value="videos">Videos Only</option>
          <option value="posts">Posts Only</option>
        </select>

        <MultiSelectDropdown<number>
          allLabel="All Years"
          itemNounPlural="years"
          searchPlaceholder="Search years..."
          options={ALL_YEARS.map(year => ({ value: year, label: String(year) }))}
          selected={selectedYears}
          onChange={setSelectedYears}
        />
      </FilterBar>

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
        </div>
      )}

      {/* Empty state */}
      {!loading && visibleItems.length === 0 && (
        <div className="text-center py-16 px-4">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-surface-sunken flex items-center justify-center">
            <BarChart3 className="w-10 h-10 text-faint" />
          </div>
          <h3 className="text-xl font-bold text-primary mb-2">
            {trimmedQuery
              ? 'No matches'
              : activeSportLabel
              ? `No ${activeSportLabel} content yet`
              : 'Nothing here yet'}
          </h3>
          <p className="text-tertiary mb-6 max-w-md mx-auto">
            {trimmedQuery
              ? 'Nothing matches that search — try different words or clear the filters.'
              : isOwnProfile
              ? 'Share posts and log activity and your performance story builds here.'
              : 'This athlete has nothing to show here yet.'}
          </p>
        </div>
      )}

      {/* Media grid — the sport's story, dominant below the numbers */}
      {!loading && visibleItems.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {visibleItems.map((item, index) => (
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
      </div>

      {/* Post Detail Modal */}
      <PostDetailModal
        postId={selectedPostIndex !== null ? visibleItems[selectedPostIndex]?.id : null}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onNavigate={handleNavigate}
        currentUserId={currentUserId}
        showNavigation={visibleItems.length > 1}
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
