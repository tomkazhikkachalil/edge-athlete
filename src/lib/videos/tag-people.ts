/**
 * Who a tagger is offered, and who they may name (game film round 2, Nov 13
 * 2026) — pure, no imports. Tom's rule: a CLUB or LEAGUE tags anyone on Edge
 * Athlete (it does not follow every player, and it tags other teams'); a
 * PERSON tags only people they are connected to — someone they follow or who
 * follows them. A typed name is always allowed, for both.
 */
export type TagOwnerKind = 'org' | 'profile';

export type TagGroup = 'side1' | 'side2' | 'roster' | 'connections';

export interface TagCandidate {
  id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  group: TagGroup;
}

export const TAG_CANDIDATES_MAX = 400;

export const TAG_WHO_REFUSALS = {
  profile: 'You can tag only people you follow or who follow you. Type their name instead.',
  gone: 'That person is not on Edge Athlete. Type their name instead.',
} as const;

/** The ids a person may NOT name on their own video: everyone outside `connected` (themself and the video's own athlete always pass). */
export function outsideConnections(ids: readonly string[], connected: ReadonlySet<string>, always: ReadonlySet<string>): string[] {
  return ids.filter(id => !always.has(id) && !connected.has(id));
}

/** One list, each person once, in the order a tagger wants them: the two sides' rosters, the rest of the organization, then connections. */
export function orderCandidates(groups: Partial<Record<TagGroup, readonly Omit<TagCandidate, 'group'>[]>>): TagCandidate[] {
  const seen = new Set<string>();
  const out: TagCandidate[] = [];
  for (const group of ['side1', 'side2', 'roster', 'connections'] as const) {
    const list = [...(groups[group] ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    for (const p of list) {
      if (seen.has(p.id) || out.length >= TAG_CANDIDATES_MAX) continue;
      seen.add(p.id);
      out.push({ ...p, group });
    }
  }
  return out;
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * What the picker lists for what was typed: every word typed starts a word of
 * the name (or the handle). With the tag's side known, that side's roster
 * comes first — the scorer of a side-2 basket is most likely a side-2 player.
 */
export function narrowCandidates(list: readonly TagCandidate[], typed: string, firstSide: 1 | 2 | null = null, limit = 12): TagCandidate[] {
  const words = fold(typed).split(' ').filter(Boolean);
  const hit = (p: TagCandidate): boolean => {
    if (words.length === 0) return true;
    const parts = [...fold(p.name).split(' '), fold(p.handle ?? '')];
    return words.every(w => parts.some(part => part.startsWith(w)));
  };
  const first: TagGroup | null = firstSide === 2 ? 'side2' : firstSide === 1 ? 'side1' : null;
  const matched = list.filter(hit);
  const ordered = first ? [...matched.filter(p => p.group === first), ...matched.filter(p => p.group !== first)] : matched;
  return ordered.slice(0, limit);
}
