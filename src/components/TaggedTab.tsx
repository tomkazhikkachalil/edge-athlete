'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Tag } from 'lucide-react';
import FilterBar from './filters/FilterBar';
import MultiSelectDropdown from './filters/MultiSelectDropdown';
import SectionEmptyState from './SectionEmptyState';
import ConfirmModal from './ConfirmModal';
import PostDetailModal from './PostDetailModal';
import TaggedTile, { type TaggedItem } from './tagged/TaggedTile';
import { useToast } from './Toast';
import {
  taggedSportOptions, taggedYearOptions,
  EMPTY_TAGGED_SUMMARY, type TaggedSummary,
} from '@/lib/tagged/display';

/**
 * The Tagged tab: posts and rounds other athletes tagged this profile in —
 * the filterable grid with tagger attribution on every tile. Filter options
 * come from the summary endpoint (what the athlete is ACTUALLY tagged in),
 * not the platform-wide catalogs. (There was a hero stat strip here for one
 * release; Tom cut it — the grid IS the content.)
 */

type SortType = 'newest' | 'most_engaged';
type MediaFilterType = 'all' | 'photos' | 'videos' | 'posts';

interface TaggedTabProps {
  profileId: string;
  currentUserId?: string;
  isOwnProfile?: boolean;
  /** Refresh the parent's tab-badge counts after an untag. */
  onCountsChanged?: () => void;
}

export default function TaggedTab({ profileId, currentUserId, isOwnProfile = false, onCountsChanged }: TaggedTabProps) {
  const { showSuccess, showError } = useToast();
  const [summary, setSummary] = useState<TaggedSummary>(EMPTY_TAGGED_SUMMARY);
  const [items, setItems] = useState<TaggedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [sort, setSort] = useState<SortType>('newest');
  const [mediaFilter, setMediaFilter] = useState<MediaFilterType>('all');
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [untagging, setUntagging] = useState<TaggedItem | null>(null);
  const [selectedPostIndex, setSelectedPostIndex] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const offsetRef = useRef(0);
  const requestSeqRef = useRef(0);
  const observerTarget = useRef<HTMLDivElement>(null);

  // Effects call functions DECLARED BELOW them (hoisted declarations, not
  // const arrows) — the athlete/[id] precedent: the loaders' state writes all
  // happen after awaits, and forward references keep the lint rules quiet
  // where a pre-declared binding would false-positive.

  useEffect(() => {
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    fetchItems(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, sort, mediaFilter, selectedSports, selectedYears]);

  // All-time summary — hero tiles + real-data filter options. Once per profile.
  async function fetchSummary() {
    try {
      const response = await fetch(`/api/profile/${profileId}/tagged-summary`, {
        credentials: 'include',
      });
      if (!response.ok) return;
      const data = await response.json();
      setSummary({
        timesTagged: data.timesTagged ?? 0,
        taggerCount: data.taggerCount ?? 0,
        sportKeys: data.sportKeys ?? [],
        years: data.years ?? [],
      });
    } catch (err) {
      console.error('Failed to load tagged summary:', err);
    }
  }

  // Paged grid — same endpoint/contract the old shared branch used, with the
  // battle-tested sequence guard + offset-ref pattern.
  async function fetchItems(resetItems = false) {
    const seq = ++requestSeqRef.current;
    try {
      if (resetItems) {
        setLoading(true);
        setLoadError(false);
        offsetRef.current = 0;
      } else {
        setLoadingMore(true);
      }

      const params = new URLSearchParams({
        tab: 'tagged',
        sort,
        mediaType: mediaFilter,
        limit: '20',
        offset: String(resetItems ? 0 : offsetRef.current),
      });
      if (selectedSports.length > 0) params.set('sportKeys', selectedSports.join(','));
      if (selectedYears.length > 0) params.set('years', selectedYears.join(','));

      const response = await fetch(`/api/profile/${profileId}/media?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Failed to fetch tagged media: ${response.status}`);
      const data = await response.json();

      if (seq !== requestSeqRef.current) return;

      setItems(prev => (resetItems ? data.items || [] : [...prev, ...(data.items || [])]));
      setHasMore(data.hasMore || false);
      offsetRef.current = data.nextOffset ?? offsetRef.current + (data.items?.length || 0);
    } catch (err) {
      console.error('Failed to fetch tagged media:', err);
      if (seq !== requestSeqRef.current) return;
      if (resetItems) {
        setItems([]);
        setHasMore(false);
        setLoadError(true);
      }
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  // Infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          fetchItems(false);
        }
      },
      { threshold: 0.1 }
    );
    const target = observerTarget.current;
    if (target) observer.observe(target);
    return () => {
      if (target) observer.unobserve(target);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore]);

  const sportOptions = useMemo(() => taggedSportOptions(summary.sportKeys), [summary.sportKeys]);
  const yearOptions = useMemo(() => taggedYearOptions(summary.years), [summary.years]);
  const activeCount = selectedSports.length + selectedYears.length;

  const handleUntag = async () => {
    if (!untagging) return;
    const target = untagging;
    setUntagging(null);
    try {
      const response = await fetch(`/api/tags?postId=${target.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to remove tag');
      setItems(prev => prev.filter(item => item.id !== target.id));
      fetchSummary();
      onCountsChanged?.();
      showSuccess('Success', 'Tag removed');
    } catch (err) {
      console.error('Failed to remove tag:', err);
      showError('Error', 'Failed to remove tag');
    }
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (selectedPostIndex === null) return;
    if (direction === 'prev' && selectedPostIndex > 0) {
      setSelectedPostIndex(selectedPostIndex - 1);
    } else if (direction === 'next' && selectedPostIndex < items.length - 1) {
      setSelectedPostIndex(selectedPostIndex + 1);
    }
  };

  return (
    <div className="w-full space-y-8">
      {/* Filters + grid — the tab pill already names the surface, so there
          is no in-tab header (Tom cut it). */}
      <div className="space-y-6">
        <FilterBar
          resultCount={items.length}
          resultNoun="post"
          activeCount={activeCount}
          onClearAll={() => {
            setSelectedSports([]);
            setSelectedYears([]);
          }}
        >
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortType)}
            className="px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="newest">Newest First</option>
            <option value="most_engaged">Most Engaged</option>
          </select>
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
          <MultiSelectDropdown<string>
            allLabel="All Sports"
            itemNounPlural="sports"
            searchPlaceholder="Search sports..."
            options={sportOptions}
            selected={selectedSports}
            onChange={setSelectedSports}
            disabled={sportOptions.length === 0}
          />
          <MultiSelectDropdown<number>
            allLabel="All Years"
            itemNounPlural="years"
            searchPlaceholder="Search years..."
            options={yearOptions.map(year => ({ value: year, label: String(year) }))}
            selected={selectedYears}
            onChange={setSelectedYears}
            disabled={yearOptions.length === 0}
          />
        </FilterBar>

        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
          </div>
        )}

        {!loading && loadError && (
          <div className="text-center py-16 px-4">
            <p className="text-tertiary mb-4">Couldn&apos;t load tagged posts.</p>
            <button
              onClick={() => fetchItems(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand-hover transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !loadError && items.length === 0 && activeCount === 0 && mediaFilter === 'all' && (
          <SectionEmptyState
            icon={Tag}
            title="No tags yet"
            body={
              isOwnProfile
                ? "When other athletes tag you in posts or shared rounds, they'll show up here."
                : "This athlete hasn't been tagged in any posts yet."
            }
          />
        )}

        {!loading && !loadError && items.length === 0 && (activeCount > 0 || mediaFilter !== 'all') && (
          <div className="text-center py-10 px-4 border border-dashed border-border rounded-lg">
            <p className="text-sm text-muted">No tagged posts match your filters.</p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {items.map((item, index) => (
              <TaggedTile
                key={item.id}
                item={item}
                isOwnProfile={isOwnProfile}
                onClick={() => {
                  setSelectedPostIndex(index);
                  setIsModalOpen(true);
                }}
                onUntag={() => setUntagging(item)}
              />
            ))}
          </div>
        )}

        {loadingMore && (
          <div className="flex justify-center items-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand"></div>
          </div>
        )}
        <div ref={observerTarget} className="h-4" />
      </div>

      <PostDetailModal
        postId={selectedPostIndex !== null ? items[selectedPostIndex]?.id : null}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedPostIndex(null);
        }}
        onNavigate={handleNavigate}
        currentUserId={currentUserId}
        showNavigation={items.length > 1}
      />

      <ConfirmModal
        isOpen={untagging !== null}
        title="Remove Tag"
        message="Remove this tag of you? The post stays up — it just won't appear on your profile anymore."
        confirmText="Remove"
        onConfirm={handleUntag}
        onCancel={() => setUntagging(null)}
      />
    </div>
  );
}
