'use client';

import { useEffect, useState } from 'react';
import StatementCard, { type StatementItem } from './StatementCard';
import PostDetailModal from './PostDetailModal';

interface StatementsRailProps {
  profileId: string;
  currentUserId?: string;
  /** Badge-accurate total from the counts RPC (items.length is page-capped). */
  totalCount?: number;
  /** Bump to refetch after the owner creates a post (mediaRefreshKey). */
  refreshKey?: number;
}

const PAGE_SIZE = 24;
/** Cards visible before "See all N ›" appears (desktop shows ~3). */
const RAIL_VISIBLE_COUNT = 3;

/**
 * The profile's Statements rail — text-only posts, split out of the Media
 * grid by migration 074. Sits between FeaturedPosts and the My Media tabs.
 * Horizontal strip (LiveNowStrip's language: hidden scrollbar, edge bleed
 * below sm, a cut-off card as the "more here" affordance); "See all N ›"
 * swaps it to a grid in place (EquipmentShelf's affordance). Renders nothing
 * when there are no statements — including pre-074, when the fetch fails.
 */
export default function StatementsRail({ profileId, currentUserId, totalCount, refreshKey }: StatementsRailProps) {
  const [items, setItems] = useState<StatementItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fetchedAll, setFetchedAll] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Cancellable async IIFE, per the eslint.config.mjs house rule — setState
  // only lands after the await, never synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/profile/${profileId}/media?tab=statements&limit=${PAGE_SIZE}`,
          { credentials: 'include' }
        );
        if (!res.ok || cancelled) return; // pre-074 the RPC is missing — the rail is a nicety
        const data = await res.json();
        if (cancelled) return;
        setItems(data.items || []);
        setHasMore(!!data.hasMore);
        setFetchedAll(!data.hasMore);
      } catch { /* never break the profile page */ }
    })();
    return () => { cancelled = true; };
  }, [profileId, refreshKey]);

  // One follow-up fetch on first expand — no infinite scroll here.
  const expand = async () => {
    setExpanded(true);
    if (fetchedAll || !hasMore) return;
    try {
      const res = await fetch(
        `/api/profile/${profileId}/media?tab=statements&limit=100&offset=${PAGE_SIZE}`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const data = await res.json();
      setItems(prev => [...prev, ...(data.items || [])]);
      setFetchedAll(true);
    } catch { /* keep the first page */ }
  };

  if (items.length === 0) return null;

  const total = totalCount && totalCount > items.length ? totalCount : items.length;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-primary">
          <i className="fas fa-quote-left text-brand-fg mr-2"></i>
          Statements
        </h3>
        {total > RAIL_VISIBLE_COUNT && (
          <button
            onClick={() => (expanded ? setExpanded(false) : expand())}
            className="text-sm font-medium text-brand-fg hover:text-brand-fg-strong"
          >
            {expanded ? 'Show less' : `See all ${total} ›`}
          </button>
        )}
      </div>

      <div
        className={
          expanded
            ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'
            : 'flex gap-3 overflow-x-auto pb-1 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0'
        }
      >
        {items.map((item, index) => (
          <div key={item.id} className={expanded ? '' : 'w-[280px] max-w-[85vw] flex-shrink-0'}>
            <StatementCard item={item} onClick={() => setSelectedIndex(index)} />
          </div>
        ))}
      </div>

      <PostDetailModal
        postId={selectedIndex !== null ? items[selectedIndex]?.id ?? null : null}
        isOpen={selectedIndex !== null}
        onClose={() => setSelectedIndex(null)}
        onNavigate={(direction) => {
          setSelectedIndex(prev => {
            if (prev === null) return prev;
            const next = direction === 'prev' ? prev - 1 : prev + 1;
            return next >= 0 && next < items.length ? next : prev;
          });
        }}
        currentUserId={currentUserId}
        showNavigation={items.length > 1}
      />
    </div>
  );
}
