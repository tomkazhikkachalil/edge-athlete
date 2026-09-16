/**
 * The phone tab bar (Events program, phase 2b, B4 — Tom: FIVE tabs, Feed ·
 * Sports · Live · Calendar · Profile, mirroring the desktop header's places;
 * Create stays in the header at every width, Messages / Notifications stay
 * header icons). Pure: the five links and the one rule for where the bar
 * shows. `TabBar.tsx` renders it once from the root layout, below `lg`.
 *
 * Where it shows: an ALLOWLIST of signed-in places, minus the screens that
 * own their bottom edge — the scorer's screen (`/live/[id]`), a message
 * thread (the composer), the event wizard (its footer) and the BrandBar
 * funnels under /app. A route outside the list (the auth and legal pages)
 * never shows it.
 */
export interface TabBarLink {
  key: 'feed' | 'sports' | 'live' | 'calendar' | 'profile';
  path: string;
  label: string;
  icon: string;
}

/** The header's `placeLinksWithLive` order — Live in the middle. */
export const TAB_BAR_LINKS: ReadonlyArray<TabBarLink> = [
  { key: 'feed', path: '/feed', label: 'Feed', icon: 'fa-home' },
  { key: 'sports', path: '/sports', label: 'Sports', icon: 'fa-medal' },
  { key: 'live', path: '/live', label: 'Live', icon: 'fa-broadcast-tower' },
  { key: 'calendar', path: '/calendar', label: 'Calendar', icon: 'fa-calendar-alt' },
  { key: 'profile', path: '/athlete', label: 'Profile', icon: 'fa-user' },
];

const PLACES = ['/feed', '/sports', '/events', '/calendar', '/athlete', '/u', '/app', '/live', '/messages', '/notifications', '/settings', '/league', '/club', '/event', '/explore', '/dashboard'] as const;

/** Screens that own their bottom edge (or render BrandBar): no bar. */
const HIDDEN_PREFIXES = ['/live/', '/messages/', '/sports/events/new', '/app/diag', '/app/transfer', '/app/guardian/consent', '/app/guardian/add-athlete', '/app/guardian/credentials'] as const;

/** Phase 4: the live stat screen owns its bottom edge too (the entry strip) — a pattern, since the id sits in the middle. */
const HIDDEN_PATTERNS: ReadonlyArray<RegExp> = [/^\/events\/[^/]+\/live$/];

export function showsTabBar(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (HIDDEN_PATTERNS.some(re => re.test(clean))) return false;
  for (const h of HIDDEN_PREFIXES) {
    if (h.endsWith('/') ? clean.startsWith(h) : clean === h || clean.startsWith(`${h}/`)) return false;
  }
  return PLACES.some(p => clean === p || clean.startsWith(`${p}/`));
}
