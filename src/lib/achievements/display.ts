/**
 * Derived display stats for the achievements trophy case. Pure — powers the
 * hero tiles, Top Finishes showcase, year timeline, and the header/public
 * pills. Placement is free text, so podium detection is a conservative
 * heuristic: prefer a miss (null) over a false podium.
 */

import type { Achievement } from './index';

export type PlacementTier = 'gold' | 'silver' | 'bronze' | 'podium';

/** Honors that contain rank words but aren't finishes ("1st Team All-State"). */
const HONOR_PATTERNS = [
  /\bteam\b/i,
  /\ball[- ](state|conference|america|american|region|league|district)\b/i,
];

/**
 * Classify free-text placement into a medal tier. 'podium' means
 * podium-level with unknown tier ("Medalist") — it never upgrades to a
 * specific medal. Returns null for anything ambiguous.
 */
export function parsePlacement(text: string | null | undefined): PlacementTier | null {
  if (!text) return null;
  const t = text.trim();
  if (t.length === 0) return null;

  if (HONOR_PATTERNS.some((p) => p.test(t))) return null;

  if (/\bgold\b/i.test(t)) return 'gold';
  if (/\bsilver\b/i.test(t)) return 'silver';
  if (/\bbronze\b/i.test(t)) return 'bronze';
  if (/\b(medal|medalist|medallist|podium)\b/i.test(t)) return 'podium';

  const tie = t.match(/\bt[- ]?([123])\b/i);
  if (tie) return (['gold', 'silver', 'bronze'] as const)[Number(tie[1]) - 1];

  // Bronze/silver before gold so "2nd" wins over an incidental "1" match.
  if (/\b(3rd|third)\b/i.test(t)) return 'bronze';
  if (/\b(2nd|second|runner[- ]?up)\b/i.test(t)) return 'silver';
  if (/\b(1st|first|champions?|winner|won)\b/i.test(t)) return 'gold';

  return null;
}

/** Sort weight: gold best. Null (non-podium) sorts last. Finite so
 *  comparator subtraction never yields NaN. */
export function tierRank(tier: PlacementTier | null): number {
  switch (tier) {
    case 'gold': return 0;
    case 'silver': return 1;
    case 'bronze': return 2;
    case 'podium': return 3;
    default: return 4;
  }
}

/** achieved_on is a bare DATE string — slice the year, never new Date(). */
function yearOf(a: Achievement): number {
  return parseInt(a.achieved_on.slice(0, 4), 10);
}

export interface AchievementStats {
  total: number;
  podiums: number;
  /** Distinct organizations (trimmed, case-insensitive; nulls excluded). */
  organizations: number;
  /** Distinct calendar years with at least one achievement. */
  yearsActive: number;
  firstYear: number | null;
  lastYear: number | null;
}

export function achievementStats(list: Achievement[]): AchievementStats {
  const orgs = new Set<string>();
  const years = new Set<number>();
  let podiums = 0;

  for (const a of list) {
    if (parsePlacement(a.placement) !== null) podiums++;
    const org = a.organization?.trim().toLowerCase();
    if (org) orgs.add(org);
    years.add(yearOf(a));
  }

  const sorted = [...years].sort((x, y) => x - y);
  return {
    total: list.length,
    podiums,
    organizations: orgs.size,
    yearsActive: years.size,
    firstYear: sorted.length > 0 ? sorted[0] : null,
    lastYear: sorted.length > 0 ? sorted[sorted.length - 1] : null,
  };
}

/** Podium finishes only, best tier first then most recent, capped. */
export function topFinishes(list: Achievement[], cap = 4): Achievement[] {
  return list
    .map((a) => ({ a, tier: parsePlacement(a.placement) }))
    .filter((x): x is { a: Achievement; tier: PlacementTier } => x.tier !== null)
    .sort((x, y) =>
      tierRank(x.tier) - tierRank(y.tier) ||
      y.a.achieved_on.localeCompare(x.a.achieved_on)
    )
    .slice(0, cap)
    .map((x) => x.a);
}

/** Newest year first; items keep their incoming (API) order within a year. */
export function groupByYear(list: Achievement[]): Array<{ year: number; items: Achievement[] }> {
  const byYear = new Map<number, Achievement[]>();
  for (const a of list) {
    const year = yearOf(a);
    const bucket = byYear.get(year);
    if (bucket) bucket.push(a);
    else byYear.set(year, [a]);
  }
  return [...byYear.entries()]
    .sort((x, y) => y[0] - x[0])
    .map(([year, items]) => ({ year, items }));
}

export interface TopPill {
  id: string;
  title: string;
  tier: PlacementTier | null;
  year: number;
}

/** Header/public pills: podium-ranked first, then most recent. */
export function topPills(list: Achievement[], n: number): TopPill[] {
  return [...list]
    .sort((x, y) =>
      tierRank(parsePlacement(x.placement)) - tierRank(parsePlacement(y.placement)) ||
      y.achieved_on.localeCompare(x.achieved_on)
    )
    .slice(0, n)
    .map((a) => ({ id: a.id, title: a.title, tier: parsePlacement(a.placement), year: yearOf(a) }));
}
