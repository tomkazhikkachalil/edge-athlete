/**
 * Shaping event media for display. Pure, so the ordering rules are testable —
 * the repo has no jsdom, so this is the only layer that can be.
 *
 * Keyed on `segment_number` (migration 061), so the same code serves a hole in
 * golf, an inning in baseball or a lap in track. Only the LABEL is sport-
 * specific, and that comes from `segment-schemas.ts` at render time.
 */

import type { RoundMediaItem } from '@/types/group-posts';
import type { CollageItem } from '@/components/media/MediaCollage';

/** A collage item that remembers which segment of the event it came from. */
export type RoundCollageItem = CollageItem & {
  segment?: number | null;
  isHighlight?: boolean | null;
  position?: number | null;
  createdAt?: string | null;
};

/**
 * A row's segment. segment_number is authoritative since the 061 backfill;
 * the hole_number fallback retired with migration 076 (column dropped).
 */
function segmentOf(m: RoundMediaItem): number | null {
  return m.segment_number ?? null;
}

/**
 * Flatten stored media into view-ready items, ordered the way the event was
 * PLAYED: segment 1 upward, with event-level (untagged) items last.
 *
 * Order matters beyond tidiness — it is the order the lightbox's prev/next
 * walks, so a viewer steps through the round rather than through whatever
 * sequence the rows happened to come back in.
 */
export function toCollageItems(media: RoundMediaItem[] | undefined | null): RoundCollageItem[] {
  if (!media?.length) return [];

  return [...media]
    .sort((a, b) => {
      // Untagged sorts last: it belongs to the event, not to a moment in it.
      // (The feed MIRROR deliberately does the opposite — see round-mirror.ts.)
      const ah = segmentOf(a) ?? Number.POSITIVE_INFINITY;
      const bh = segmentOf(b) ?? Number.POSITIVE_INFINITY;
      if (ah !== bh) return ah - bh;
      // Stable within a segment so the order never jitters between renders.
      return a.id.localeCompare(b.id);
    })
    .map(m => ({
      id: m.id,
      url: m.media_url,
      kind: m.media_type === 'video' ? ('video' as const) : ('image' as const),
      thumbnailUrl: m.thumbnail_url ?? null,
      alt: m.caption || 'Round media',
      durationSeconds: m.duration_seconds ?? null,
      // Carried so callers can label, and so the hero picker can rank,
      // without a second lookup.
      segment: segmentOf(m),
      isHighlight: m.is_highlight ?? false,
      position: m.position ?? null,
      createdAt: m.created_at ?? null,
    }));
}

/**
 * Group display items by segment, preserving the play order above. Returns
 * entries rather than a Map so callers can render directly without converting.
 */
export function groupMediaBySegment(
  items: RoundCollageItem[]
): Array<[number | null, RoundCollageItem[]]> {
  const bySegment = new Map<number | null, RoundCollageItem[]>();

  for (const item of items) {
    const key = item.segment ?? null;
    const bucket = bySegment.get(key);
    if (bucket) bucket.push(item);
    else bySegment.set(key, [item]);
  }

  // Insertion order already reflects play order because `items` is sorted, so
  // no second sort is needed — and re-sorting would risk disagreeing with the
  // flat list the lightbox indexes into.
  return [...bySegment.entries()];
}
