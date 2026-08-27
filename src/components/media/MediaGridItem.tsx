'use client';

/**
 * One square tile in a profile media grid — extracted verbatim from
 * ProfileMediaTabs (Aug 2026) so the Media tab and the Stats hub render
 * identical tiles from one implementation. The exported `MediaItem` mirrors
 * the /api/profile/[profileId]/media row shape.
 */

import { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import OptimizedImage, { AvatarImage } from '../OptimizedImage';
import { buildStatHighlights, type StatPlayer } from '@/lib/sports/post-stat-highlights';
import { toParColorClass } from '@/lib/golf/scoring';
import { getInitials } from '@/lib/formatters';
import { buildStatsSummary } from '@/lib/sports/stats-summary';

export interface MediaItem {
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

export default function MediaGridItem({ item, viewerId, onClick }: MediaGridItemProps) {
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
      const summary = buildStatsSummary({ statsData: item.stats_data });
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
