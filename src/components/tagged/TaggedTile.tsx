'use client';

import { formatDistanceToNow } from 'date-fns';
import { Heart, MessageCircle, Layers, X, Flag, TrendingUp, BarChart3 } from 'lucide-react';
import MediaTile from '../media/MediaTile';
import { formatGolfStatsSummary, formatGenericStatsSummary } from '@/lib/stats-summary';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import Image from 'next/image';

/**
 * One tagged post: the media (MediaTile — videos render as poster frames,
 * never raw <video>) with a pinned attribution strip naming WHO tagged you
 * (the post author — that's what a tagged surface is about). Owner-only
 * "Remove tag" affordance in the top-right. No green "Tagged" chip: every
 * tile here is tagged by definition.
 */

export interface TaggedItem {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: Record<string, unknown> | null;
  created_at: string;
  profile_id: string;
  profile_first_name: string | null;
  profile_last_name: string | null;
  profile_full_name: string | null;
  profile_avatar_url: string | null;
  media_count: number;
  likes_count: number;
  comments_count: number;
  media?: Array<{
    id: string;
    media_url: string;
    media_type: 'image' | 'video';
    display_order: number;
    thumbnail_url?: string | null;
  }>;
  golf_round?: {
    course: string | null;
    gross_score: number | null;
    par: number | null;
    holes: number | null;
  } | null;
}

interface TaggedTileProps {
  item: TaggedItem;
  isOwnProfile: boolean;
  onClick: () => void;
  onUntag: () => void;
}

function taggerName(item: TaggedItem): string {
  const first = item.profile_first_name?.trim();
  const last = item.profile_last_name?.trim();
  if (first || last) return [first, last].filter(Boolean).join(' ');
  return item.profile_full_name ?? 'Unknown athlete';
}

/** Text/stats body for media-less posts — golf gets its score line. */
function FallbackBody({ item }: { item: TaggedItem }) {
  if (item.golf_round) {
    const summary = formatGolfStatsSummary(item.golf_round);
    if (summary) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-green-50 via-emerald-50 to-green-100 dark:from-green-950/40 dark:via-emerald-950/40 dark:to-green-950/60 p-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-600">
            <Flag className="w-4 h-4 text-white" aria-hidden="true" />
          </span>
          <div className="text-center">
            <div className="text-sm font-bold text-primary line-clamp-2">{summary.primaryLine}</div>
            {summary.secondaryLine && (
              <div className="text-xs text-green-700 dark:text-green-300 font-semibold line-clamp-1">{summary.secondaryLine}</div>
            )}
          </div>
        </div>
      );
    }
  }
  if (item.stats_data && Object.keys(item.stats_data).length > 0) {
    const summary = formatGenericStatsSummary(item.stats_data);
    if (summary) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-violet-50 via-purple-50 to-violet-100 dark:from-violet-950/40 dark:via-purple-950/40 dark:to-violet-950/60 p-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand">
            <TrendingUp className="w-4 h-4 text-white" aria-hidden="true" />
          </span>
          <div className="text-center">
            <div className="text-sm font-bold text-primary line-clamp-2">{summary.primaryLine}</div>
            {summary.secondaryLine && (
              <div className="text-xs text-brand-fg-strong font-semibold line-clamp-1">{summary.secondaryLine}</div>
            )}
          </div>
        </div>
      );
    }
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-stone-900 dark:to-stone-800 p-4">
      <p className="text-sm text-secondary line-clamp-4 text-center">{item.caption || 'Post'}</p>
    </div>
  );
}

export default function TaggedTile({ item, isOwnProfile, onClick, onUntag }: TaggedTileProps) {
  const firstMedia = item.media && item.media.length > 0 ? item.media[0] : null;
  const name = taggerName(item);
  const hasStats = Boolean(item.golf_round) ||
    Boolean(item.stats_data && Object.keys(item.stats_data).length > 0);

  const overlay = (
    <>
      {/* Hover scrim with engagement + recency */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors">
        <div className="absolute top-2 right-2 flex gap-1">
          {hasStats && firstMedia && (
            <span className="flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">
              <BarChart3 className="w-3 h-3" aria-hidden="true" />
              Stats
            </span>
          )}
          {item.media_count > 1 && (
            <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
              <Layers className="w-3 h-3" aria-hidden="true" />
              {item.media_count}
            </span>
          )}
        </div>
        {/* Engagement row: hover on fine pointers, always on coarse — touch
            has no hover. It needs its own scrim (the hover tint above stays
            hover-only): always-visible white 11px text straight on an
            arbitrary photo is unreadable. */}
        <div className="absolute inset-x-0 bottom-8 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1 pt-4 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-opacity">
          <div className="flex items-center justify-between text-[11px] text-white">
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1"><Heart className="w-3 h-3" aria-hidden="true" />{item.likes_count}</span>
              <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3" aria-hidden="true" />{item.comments_count}</span>
            </span>
            {/* A 124px tile at 320px can't fit "about 2 hours ago" beside the
                counts — same gate MediaGridItem uses. */}
            <span className="text-gray-200 hidden min-[380px]:inline">
              {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
            </span>
          </div>
        </div>
      </div>

      {/* Attribution strip — who tagged you. Always visible. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/75 to-black/0 px-2 pb-1.5 pt-4">
        {item.profile_avatar_url && isOptimizableImageSrc(item.profile_avatar_url) ? (
          <Image
            src={item.profile_avatar_url}
            alt=""
            width={16}
            height={16}
            className="h-4 w-4 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/30 text-[9px] font-bold text-white">
            {name.charAt(0)}
          </span>
        )}
        <span className="truncate text-[11px] font-medium text-white">by {name}</span>
      </div>
    </>
  );

  return (
    <div className="relative group">
      {firstMedia ? (
        <MediaTile
          src={firstMedia.media_url}
          thumbnailUrl={firstMedia.thumbnail_url}
          kind={firstMedia.media_type}
          alt={item.caption || `Post by ${name}`}
          overlay={overlay}
          onClick={onClick}
          className="aspect-square rounded-lg w-full"
        />
      ) : (
        <button
          type="button"
          onClick={onClick}
          aria-label={item.caption || `Post by ${name}`}
          className="relative block w-full aspect-square overflow-hidden rounded-lg bg-surface-sunken"
        >
          <FallbackBody item={item} />
          {overlay}
        </button>
      )}

      {/* Owner-only untag — outside the tile button (nested buttons are
          invalid HTML and break click targets). pointer-coarse: because this
          is the ONLY untag affordance on the surface — hover-revealed meant
          it did not exist on touch at all. */}
      {isOwnProfile && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUntag();
          }}
          aria-label={`Remove tag from post by ${name}`}
          className="absolute top-2 left-2 z-10 flex h-6 w-6 after:absolute after:content-[''] after:-inset-2.5 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 hover:bg-black/75 active:bg-black/75"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
