import { BADGES, TIER_ORDER, badgeDef, type BadgeDef } from './catalog';

/**
 * The trophy case's view of earned badges — pure (the component renders
 * this; the test pins it). The Play program (244).
 */

export interface EarnedBadge {
  key: string;
  sportKey: string | null;
  earnedOn: string;
  verified: boolean;
  detail: Record<string, number>;
}

export interface BadgeView extends EarnedBadge {
  def: BadgeDef;
}

export interface SportShelf {
  /** null = across sports. */
  sportKey: string | null;
  badges: BadgeView[];
  /** The owner's "Up next": unearned badges in a sport they play (dimmed). */
  next: BadgeDef[];
}

/** Known badges only (a key the catalog dropped is not rendered), best tier first, then newest. */
export function badgeViews(earned: readonly EarnedBadge[]): BadgeView[] {
  const out: BadgeView[] = [];
  for (const e of earned) {
    const def = badgeDef(e.key);
    if (def) out.push({ ...e, def });
  }
  return out.sort((a, b) => TIER_ORDER[a.def.tier] - TIER_ORDER[b.def.tier] || b.earnedOn.localeCompare(a.earnedOn) || a.key.localeCompare(b.key));
}

/** Shelves per sport (most badges first; across-sports last). `withNext` adds up to `nextCount` unearned badges per sport shelf. */
export function badgeShelves(earned: readonly EarnedBadge[], opts: { withNext?: boolean; nextCount?: number } = {}): SportShelf[] {
  const views = badgeViews(earned);
  const held = new Set(views.map(v => v.key));
  const bySport = new Map<string | null, BadgeView[]>();
  for (const v of views) {
    const list = bySport.get(v.def.sportKey);
    if (list) list.push(v);
    else bySport.set(v.def.sportKey, [v]);
  }
  const shelves: SportShelf[] = [...bySport.entries()].map(([sportKey, badges]) => ({
    sportKey,
    badges,
    next: opts.withNext && sportKey !== null ? upNext(sportKey, held, opts.nextCount ?? 3) : [],
  }));
  return shelves.sort((a, b) => (a.sportKey === null ? 1 : 0) - (b.sportKey === null ? 1 : 0) || b.badges.length - a.badges.length);
}

/** The next few unearned badges in a sport, easiest first: catalog order within each tier (bronze → gold). */
export function upNext(sportKey: string, held: ReadonlySet<string>, count: number): BadgeDef[] {
  return BADGES.filter(b => b.sportKey === sportKey && !held.has(b.key))
    .sort((a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier])
    .slice(0, count);
}

/** "Shot 78" / "31 points" — the number that earned it, when there is one. */
export function earnedLine(v: BadgeView): string | null {
  const d = v.detail;
  if (typeof d.gross === 'number') return `Shot ${d.gross}`;
  if (typeof d.to_par === 'number') return `${d.to_par} to par`;
  if (typeof d.handicap_index === 'number') return `Index ${d.handicap_index.toFixed(1)}`;
  if (typeof d.results === 'number') return `${d.results} logged`;
  if (typeof d.sports === 'number') return `${d.sports} sports`;
  const [k, n] = Object.entries(d)[0] ?? [];
  return typeof n === 'number' ? `${n} ${String(k).replace(/_/g, ' ')}` : null;
}
