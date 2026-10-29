// ── The launch gate (Sep 30 2026) — pure, ZERO imports ─────────────────────
// Tom, the night edgeathlete.ca went live early: "put a coming soon banner /
// block new users from signing up for now." NEXT_PUBLIC_LAUNCH_GATE=1 (read in the Edge
// middleware — BUILD-INJECTED like its sibling flags: a real build, not a
// redeploy) sends every signed-OUT visitor to the coming-soon page, on every
// path but the few below, and /api/signup refuses. A signed-in account (Tom)
// sees the whole app; the APIs and the scheduled jobs are untouched (the
// matcher never covers /api). Turning it off is the flag plus a build.
//
// Zero imports on purpose: the middleware's edge bundle imports this file.

export const COMING_SOON_PATH = '/auth/coming-soon';

/** The query that lets the login form show at `/` while the gate is up:
 *  the coming-soon page links to it ("Have an account? Sign in"). */
export const SIGNIN_QUERY = 'signin';

/** Paths a signed-out visitor may still reach while the gate is up. */
const OPEN_PREFIXES = [
  '/auth/', // the coming-soon page itself, the OAuth callback, complete-profile (session-gated on its own)
  '/forgot-password',
  '/reset-password',
  '/privacy', // named by the Google consent screen
  '/terms',
  '/admin', // the admin console's own door (Oct 19 2026): its own sign-in protects it
];

/** Static files the matcher lets through (favicons, manifest, fonts, images). */
const STATIC_RE = /\.(png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?|ttf|json|webmanifest|txt|xml|js|css|map)$/i;

export function isLaunchGateOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_LAUNCH_GATE === '1';
}

/** The query that carries the way back through the gate (the sign-in page
 *  at `/` already honours it — the invite claim's path, the workout's door). */
export const RETURN_QUERY = 'next';

/**
 * A return path the gate will carry: an internal absolute path, never a
 * protocol-relative one (`//evil`) — the same rule as safeInternalPath,
 * repeated here because this file imports nothing.
 */
export function gateReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value === '/' || value.startsWith('/?')) return null; // the sign-in page itself: nothing to come back to
  return value;
}

/**
 * Where a SIGNED-OUT request goes while the gate is up: null = let it
 * through, else the path to redirect to. `search` is the raw query string.
 *
 * The gate carries the way back (Oct 28 2026): a signed-out visit to an
 * app path lands on coming-soon with `?next=<that path>`, and the page's
 * sign-in link passes it on to `/?signin=1&next=…`, so an existing account
 * that opened a workout link on a phone which dropped its session comes
 * back to the workout after signing in — never to the feed. A visit to `/`
 * that already carries `?next=` (the app's own doors send that) keeps it.
 */
export function launchGateRedirect(pathname: string, search: string): string | null {
  if (pathname === COMING_SOON_PATH) return null;
  if (OPEN_PREFIXES.some(p => pathname === p || pathname.startsWith(p))) return null;
  const query = new URLSearchParams(search);
  if (pathname === '/' && query.get(SIGNIN_QUERY) === '1') return null;
  if (STATIC_RE.test(pathname) && !/^\/(robots\.txt|sitemap\.xml)$/.test(pathname)) return null;
  const next = gateReturnPath(pathname === '/' ? query.get(RETURN_QUERY) : pathname + search);
  return next ? `${COMING_SOON_PATH}?${RETURN_QUERY}=${encodeURIComponent(next)}` : COMING_SOON_PATH;
}

/** The coming-soon page's sign-in link: the one door, carrying the way back when there is one. */
export function comingSoonSignInHref(next: string | null | undefined): string {
  const back = gateReturnPath(next);
  return back ? `/?${SIGNIN_QUERY}=1&${RETURN_QUERY}=${encodeURIComponent(back)}` : `/?${SIGNIN_QUERY}=1`;
}

/** The crawler files while the gate is up: nothing is indexed. */
export const GATED_ROBOTS = 'User-agent: *\nDisallow: /\n';
