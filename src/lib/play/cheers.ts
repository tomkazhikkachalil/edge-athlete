/**
 * Live cheers — the Play program (244). Pure, client-safe.
 *
 * A spectator (or a teammate) taps an emoji on a LIVE round; everyone
 * watching sees it float up, and the round keeps a count. A cheer is a KEY
 * from this fixed set of six (244's CHECK) — never free text, never a name:
 * cheers are anonymous by design, so they are no contact surface (nothing
 * to moderate, nothing a stranger can say to a minor).
 *
 * Every sport: a golf shared round is `group_post:<id>` (event rounds mint
 * one), a stat event's round is `sport_event_round:<id>` — the fact table's
 * own context keys (P2).
 */

export const CHEERS = [
  { key: 'fire', emoji: '🔥', label: 'Fire' },
  { key: 'clap', emoji: '👏', label: 'Applause' },
  { key: 'flex', emoji: '💪', label: 'Strong' },
  { key: 'target', emoji: '🎯', label: 'Dialed in' },
  { key: 'hands', emoji: '🙌', label: 'Let’s go' },
  { key: 'wow', emoji: '😮', label: 'Wow' },
] as const;

export type CheerKey = (typeof CHEERS)[number]['key'];

const KEYS = new Set<string>(CHEERS.map(c => c.key));
export const isCheerKey = (v: unknown): v is CheerKey => typeof v === 'string' && KEYS.has(v);
export const cheerEmoji = (key: CheerKey): string => CHEERS.find(c => c.key === key)!.emoji;

export type CheerContextKind = 'group_post' | 'sport_event_round';

export function parseCheerContext(key: unknown): { kind: CheerContextKind; id: string } | null {
  const m = typeof key === 'string' ? /^(group_post|sport_event_round):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(key) : null;
  return m ? { kind: m[1] as CheerContextKind, id: m[2] } : null;
}

export interface CheerEvent { id: string; cheer: CheerKey; target: string | null; at: string }

export interface CheerFeed {
  totals: Record<CheerKey, number>;
  total: number;
  recent: CheerEvent[];
  /** The server's clock — the next poll's `since`. */
  now: string;
}

export function emptyTotals(): Record<CheerKey, number> {
  return { fire: 0, clap: 0, flex: 0, target: 0, hands: 0, wow: 0 };
}

/** Count rows per key (unknown keys ignored). */
export function tally(rows: ReadonlyArray<{ cheer: string }>): { totals: Record<CheerKey, number>; total: number } {
  const totals = emptyTotals();
  let total = 0;
  for (const r of rows) {
    if (!isCheerKey(r.cheer)) continue;
    totals[r.cheer]++;
    total++;
  }
  return { totals, total };
}

/** The feed's new events, oldest first, never one already seen (poll overlap, the viewer's own optimistic float). */
export function freshEvents(recent: readonly CheerEvent[], seen: ReadonlySet<string>): CheerEvent[] {
  return [...recent].filter(e => !seen.has(e.id)).sort((a, b) => a.at.localeCompare(b.at));
}
