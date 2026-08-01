/**
 * Which item leads — the hero at the top of the Overview and the lead image on
 * the feed card.
 *
 * Pure, and sport-agnostic: the "best segment" arrives as a NUMBER from the
 * caller (golf works it out from scores), so nothing here knows what a hole is.
 *
 * The chain, in order:
 *   1. an item the athlete explicitly flagged
 *   2. the first video — motion beats a still for a highlight
 *   3. anything from the best-scoring segment
 *   4. the earliest item
 *
 * Every rung tie-breaks the same way, so the answer is STABLE: the hero must
 * not change between renders or between two viewers looking at the same round.
 */

export interface HeroCandidate {
  id: string;
  kind: 'image' | 'video';
  segment?: number | null;
  isHighlight?: boolean | null;
  /** Ordering hint from the source row; lower is earlier. */
  position?: number | null;
  createdAt?: string | null;
}

/**
 * Total order used to break every tie, so the chain is deterministic even when
 * several items qualify equally. `position` first (the author's own ordering),
 * then capture time, then id as a final backstop — id alone would be arbitrary
 * but it is never reached before the two meaningful keys.
 */
function compareCandidates(a: HeroCandidate, b: HeroCandidate): number {
  const ap = a.position ?? Number.POSITIVE_INFINITY;
  const bp = b.position ?? Number.POSITIVE_INFINITY;
  if (ap !== bp) return ap - bp;
  const at = a.createdAt ?? '';
  const bt = b.createdAt ?? '';
  if (at !== bt) return at.localeCompare(bt);
  return a.id.localeCompare(b.id);
}

function firstBy<T extends HeroCandidate>(items: T[], predicate: (i: T) => boolean): T | null {
  const matches = items.filter(predicate);
  if (matches.length === 0) return null;
  return [...matches].sort(compareCandidates)[0];
}

export interface HeroContext {
  /** The segment worth leading with, e.g. the best-scoring hole. */
  bestSegment?: number | null;
}

/** The single item to lead with, or null when there is no media at all. */
export function pickHeroMedia<T extends HeroCandidate>(
  items: T[],
  ctx: HeroContext = {}
): T | null {
  if (!items || items.length === 0) return null;

  const chosen = firstBy(items, i => i.isHighlight === true);
  if (chosen) return chosen;

  const video = firstBy(items, i => i.kind === 'video');
  if (video) return video;

  if (ctx.bestSegment !== null && ctx.bestSegment !== undefined) {
    const fromBest = firstBy(items, i => i.segment === ctx.bestSegment);
    if (fromBest) return fromBest;
  }

  return [...items].sort(compareCandidates)[0];
}

/**
 * The handful shown on the Overview: the hero first, then the next best by the
 * same ordering. Never repeats the hero.
 */
export function pickOverviewMedia<T extends HeroCandidate>(
  items: T[],
  ctx: HeroContext = {},
  n = 2
): T[] {
  if (!items || items.length === 0 || n <= 0) return [];

  const hero = pickHeroMedia(items, ctx);
  if (!hero) return [];

  const rest = items.filter(i => i.id !== hero.id).sort(compareCandidates);
  return [hero, ...rest].slice(0, n);
}
