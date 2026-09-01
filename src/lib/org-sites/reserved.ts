// ── Reserved root slugs (phase 6 R1) — pure, ZERO imports ───────────────────
// The vanity tree (src/app/(public)/[slug]/) makes every unreserved root
// path an org-site candidate, and the middleware gives such paths the
// static-CSP fast path WITHOUT the auth round trip. The failure modes are
// asymmetric: an unknown junk path getting the fast path just 404s in the
// (public) tree (harmless), but a REAL app route missing from this list
// silently loses session refresh. So this set must be a superset of every
// routable root segment — reserved.test.ts asserts it against the live
// src/app/(app) directory listing plus the root-level entries, and a new
// root segment FAILS `npm run verify` until it is added here (and to a
// future reserved_handles migration).
//
// Zero imports on purpose (the subdomain.ts pattern): the middleware's
// edge bundle imports this file, so it must stay dependency-free.

export const RESERVED_ROOT_SLUGS: ReadonlySet<string> = new Set([
  // Every routable segment under src/app/(app) — asserted by the test.
  'activate',
  'app',
  'athlete',
  'athlete-claim',
  'auth',
  'calendar',
  'club',
  'contact',
  'dashboard',
  'explore',
  'feed',
  'forgot-password',
  'goodbye',
  'invite',
  'league',
  'live',
  'login',
  'messages',
  'notifications',
  'onboarding',
  'org-claim',
  'privacy',
  'register',
  'reset-password',
  'settings',
  'terms',
  'u',
  // Root-level entries outside the (app) group.
  'api',
  'org',
  'robots.txt',
  'sitemap.xml',
  'favicon.ico',
  'manifest.webmanifest',
  // Next metadata file conventions (would shadow generated routes).
  'opengraph-image',
  'twitter-image',
  'icon',
  'apple-icon',
  // Future-proofing: paths the app may plausibly claim later, and words
  // whose loss to an org would be confusing or squat-shaped.
  'about',
  'help',
  'support',
  'legal',
  'signup',
  'signin',
  'sign-in',
  'sign-up',
  'home',
  'index',
  'search',
  'blog',
  'docs',
  'pricing',
  'assets',
  'static',
  'media',
  'www',
  'preview',
  'admin',
  'account',
  'profile',
  'user',
  'users',
  'athletes',
  'clubs',
  'leagues',
  'teams',
  'events',
  'news',
  'store',
  'shop',
]);

/** First path segment of a pathname, lowercased ('' for '/'). */
export function firstPathSegment(pathname: string): string {
  const trimmed = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const slash = trimmed.indexOf('/');
  return (slash === -1 ? trimmed : trimmed.slice(0, slash)).toLowerCase();
}
