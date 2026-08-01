/**
 * Shaping round media for display. Pure, so the ordering rules are testable —
 * the repo has no jsdom, so this is the only layer that can be.
 *
 * Stage note: keyed on `hole_number` today. When the sport-agnostic
 * `segment_number` lands these become segment-keyed and the golf wording goes
 * away; the ordering semantics below are deliberately written to survive that.
 */

import type { RoundMediaItem } from '@/types/group-posts';
import type { CollageItem } from '@/components/media/MediaCollage';

/**
 * Flatten stored media into view-ready items, ordered the way the round was
 * PLAYED: hole 1 upward, with round-level (untagged) items last.
 *
 * Order matters beyond tidiness — it is the order the lightbox's prev/next
 * walks, so a viewer steps through the round rather than through whatever
 * sequence the rows happened to come back in.
 */
export function toCollageItems(media: RoundMediaItem[] | undefined | null): CollageItem[] {
  if (!media?.length) return [];

  return [...media]
    .sort((a, b) => {
      // Untagged sorts last: it belongs to the round, not to a moment in it.
      const ah = a.hole_number ?? Number.POSITIVE_INFINITY;
      const bh = b.hole_number ?? Number.POSITIVE_INFINITY;
      if (ah !== bh) return ah - bh;
      // Stable within a hole so the order never jitters between renders.
      return a.id.localeCompare(b.id);
    })
    .map(m => ({
      id: m.id,
      url: m.media_url,
      kind: m.media_type === 'video' ? ('video' as const) : ('image' as const),
      thumbnailUrl: m.thumbnail_url ?? null,
      alt: m.caption || (m.hole_number ? `Hole ${m.hole_number}` : 'Round media'),
      // Set by the hole/segment number so callers can label without a lookup.
      hole: m.hole_number ?? null,
    }));
}

/** A collage item that remembers which hole it came from. */
export type RoundCollageItem = CollageItem & { hole?: number | null };

/**
 * Group display items by hole, preserving the play order above. Returns
 * entries rather than a Map so callers can render directly without converting.
 */
export function groupMediaByHole(
  items: RoundCollageItem[]
): Array<[number | null, RoundCollageItem[]]> {
  const byHole = new Map<number | null, RoundCollageItem[]>();

  for (const item of items) {
    const key = item.hole ?? null;
    const bucket = byHole.get(key);
    if (bucket) bucket.push(item);
    else byHole.set(key, [item]);
  }

  // Insertion order already reflects play order because `items` is sorted, so
  // no second sort is needed — and re-sorting would risk disagreeing with the
  // flat list the lightbox indexes into.
  return [...byHole.entries()];
}
