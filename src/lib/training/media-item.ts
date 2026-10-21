// ── A training post as a grid tile (Training fixes PR 2, Oct 21 2026) ────────
// Tom: the Training Activity posts showed their media full-width (~800 px on
// a desktop profile); the Stats and Media tabs show a tile grid with a "+N"
// badge that opens the post. The tab now renders the SAME tile
// (`MediaGridItem`), so this maps the Training API's training post row onto
// the tile's `MediaItem` shape. Pure; only the type is imported.

import type { MediaItem } from '@/components/media/MediaGridItem';

export interface TrainingPostRow {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: Record<string, unknown> | null;
  visibility: string;
  created_at: string;
  likes_count?: number | null;
  comments_count?: number | null;
  saves_count?: number | null;
  profile: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
  };
  media?: Array<{
    id: string;
    media_url: string;
    media_type: 'image' | 'video';
    display_order: number;
    thumbnail_url?: string | null;
    blur_hash?: string | null;
  }> | null;
}

/** The tile's row from a training post; media in display order. */
export function toMediaItem(post: TrainingPostRow, viewerId: string | null | undefined): MediaItem {
  const media = [...(post.media ?? [])].sort((a, b) => a.display_order - b.display_order);
  return {
    id: post.id,
    caption: post.caption,
    sport_key: post.sport_key,
    stats_data: post.stats_data,
    visibility: post.visibility,
    created_at: post.created_at,
    profile_id: post.profile.id,
    profile_first_name: post.profile.first_name,
    profile_last_name: post.profile.last_name,
    profile_full_name: post.profile.full_name,
    profile_avatar_url: post.profile.avatar_url,
    media_count: media.length,
    likes_count: post.likes_count ?? 0,
    comments_count: post.comments_count ?? 0,
    saves_count: post.saves_count ?? 0,
    tags: null,
    hashtags: null,
    is_own_post: !!viewerId && viewerId === post.profile.id,
    is_tagged: false,
    media: media.map(m => ({
      id: m.id,
      media_url: m.media_url,
      media_type: m.media_type,
      thumbnail_url: m.thumbnail_url ?? null,
      blur_hash: m.blur_hash ?? null,
      display_order: m.display_order,
    })),
  };
}
