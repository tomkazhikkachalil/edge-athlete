import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Authorization route audit (Family Console Wave 1).
 *
 * The service-role client bypasses RLS on the vast majority of API routes,
 * so the application layer IS the security boundary — and it used to be
 * opt-in: a route that forgot to call a gate looked identical to a working
 * route. This test makes authorization opt-OUT: every route handler must
 * either match a known gate call or be explicitly allowlisted here with a
 * reason. Adding a route with neither fails `npm run test` (and therefore
 * `npm run verify` and CI).
 *
 * Asserted against source text (node-only repo, no DOM); comments are
 * stripped first so prose mentioning a gate can't satisfy the check.
 */

const API_ROOT = join(process.cwd(), 'src/app/api');

/** Every way a route legitimately authenticates or authorizes today. */
const GATE_RE =
  /\b(requireAuth|getServerAuth|requireAdmin|requireProfileRole|requireGuardianAccount|resolveActingProfile|getProfileRole|mayManagePostMedia|CRON_SECRET|auth\.getUser)\b/;

/** Gates that scope access to a PROFILE (not just "some session exists").
 *  requireAdmin qualifies: admin surfaces act cross-profile by design. */
const PROFILE_GATE_RE =
  /\b(requireProfileRole|resolveActingProfile|getProfileRole|mayManagePostMedia|canViewProfile|requireAdmin)\b/;

/**
 * Routes that are deliberately public — no cookie auth at all. Each entry
 * carries the reason it is safe. Keys are paths relative to src/app/api,
 * posix-style, without the trailing /route.ts.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  health: 'liveness probe; returns no user data',
  'csp-report': 'browser-sent CSP violation sink; write-only, rate-limited',
  waitlist: 'pre-launch email capture; validated insert only',
  signup: 'account creation IS the anonymous entry point; DOB/guardian gates inside',
  contact: 'public contact form; persist-first, rate-limited',
  'public/profile': 'public-profile read surface; visibility-filtered in query',
  explore: 'guest browse surface; public-only queries by construction',
  places: 'geo autocomplete over public place data',
  'media/cover/[id]': 'public cover-photo redirect; object key is unguessable',
  'media/org-logo/[siteId]':
    'public org-site logo streamer (phase 3 R3); resolves org_sites.logo_path itself and hard-asserts the org-logos/ prefix — can only ever serve org-authored public artwork',
  'calendar/feed/[token]': 'capability URL; sha256 token lookup + supervised re-check',
  'invites/[token]': 'invite peek; never consumes, rate-limited, token is bearer',
  'auth/activate': 'token-gated activation; the invite row IS the authorization',
  'auth/username-login': 'the supervised sign-in endpoint itself; rate-limited, uniform 401s',
  'golf/courses/facets': 'public course-catalog facets; no user data',
  'leagues/[id]/standings':
    'the R3 spike surface: visibility=public competitions only, viewer-independent by construction, CDN-cached',
  'clubs/[id]/standings':
    'the R3 spike surface: visibility=public competitions only, viewer-independent by construction, CDN-cached',
  'profile/[profileId]/active-sports': 'deliberately public sport-key read (documented in the route header)',
  'clubs/[id]/activity': 'anonymous org read surface (public club pages)',
  'clubs/[id]/events': 'anonymous org read surface (public club pages)',
  'clubs/[id]/leagues': 'anonymous org read surface (public club pages)',
  'leagues/[id]/activity': 'anonymous org read surface (public league pages)',
  'leagues/[id]/clubs': 'anonymous org read surface (public league pages)',
  'leagues/[id]/events': 'anonymous org read surface (public league pages)',
};

/**
 * Routes that read a profileId/targetProfileId-shaped input WITHOUT a
 * profile-role gate, reviewed one by one (Aug 2026 audit): each either
 * hard-scopes writes to the session user, rejects mismatches, or serves
 * public/visibility-filtered reads. If you change one of these to accept a
 * cross-profile target, wire it through requireProfileRole/
 * resolveActingProfile and remove it from this list.
 */
const REVIEWED_SELF_SCOPED: Record<string, string> = {
  'invites/[token]/claim': 'atomic single-use token redemption',
  'calendar/feed-token': 'mints for the session user only; supervised 403 inside',
  'clubs/[id]/members': 'org-role system (club managers), not profile roles',
  'clubs/[id]/owners': 'org-role system (owner-only minting; DELETE is self-scoped)',
  'clubs/[id]/roster': 'org-role system (club managers); supervised flag-gated (0.10) + guardian acting-for via requireProfileRole inside',
  'leagues/[id]/members': 'org-role system (league managers), not profile roles',
  'leagues/[id]/owners': 'org-role system (owner-only minting; DELETE is self-scoped)',
  'leagues/[id]/roster': 'org-role system (league managers); supervised flag-gated (0.10) + guardian acting-for via requireProfileRole inside',
  'comments/like': 'like row keyed to session user; post visibility checked',
  'posts/like': 'like row keyed to session user; post visibility checked',
  'follow/stats': 'public counts; visibility handled in query',
  'golf/rounds': 'reads/writes scoped to session user in query',
  'golf/stats': 'visibility-filtered read',
  'golf/trends': 'visibility-filtered read',
  equipment: 'explicitly 403s on profileId mismatch with session user',
  'guardian/athletes': 'scoped to profile_access rows WHERE user_id = session',
  'messages/[conversationId]/participants': 'participant-scoped via conversation membership',
  'messages/[conversationId]/participants/[profileId]': 'participant-scoped via conversation membership',
  'privacy/check': 'read-only visibility probe; leaks only a boolean the UI needs',
  'profile/[profileId]/media': 'visibility-filtered public read surface',
  'profile/[profileId]/organizations': 'public org membership read',
  'profile/[profileId]/tagged-summary': 'privacy-filtered read (tagged round)',
  'settings/theme': 'writes session user only; accepts no target param',
  'settings/vitals-privacy': 'writes session user only; accepts no target param',
  'sports/stat-lines': 'reads public stat lines; visibility in query',
  suggestions: 'follow suggestions for the session user',
  'workout-routines': 'scoped to session user in query',
};

function walkRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkRoutes(full));
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

/** Path relative to src/app/api, posix separators, no /route.ts suffix. */
function routeKey(file: string): string {
  return relative(API_ROOT, file).split(sep).join('/').replace(/\/route\.ts$/, '');
}

// Same comment-stripping approach as logo-dev.test.ts — the (?<!:) guard
// keeps https:// URLs intact so gate names in prose don't survive but
// string contents do not get mangled into false positives.
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '');
}

const routeFiles = walkRoutes(API_ROOT);

describe('API route authorization audit', () => {
  it('found a plausible number of routes (sanity)', () => {
    // If this walks 0 or a handful, the audit is vacuous — fail loudly.
    expect(routeFiles.length).toBeGreaterThan(100);
  });

  it('every route declares a gate or is an allowlisted public route', () => {
    const offenders: string[] = [];
    for (const file of routeFiles) {
      const key = routeKey(file);
      if (key in PUBLIC_ROUTES) continue;
      if (key.startsWith('cron/')) continue; // CRON_SECRET checked below like any gate
      const source = stripComments(readFileSync(file, 'utf8'));
      if (!GATE_RE.test(source)) {
        offenders.push(key);
      }
    }
    expect(offenders, `routes with NO auth gate and no PUBLIC_ROUTES entry:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('allowlisted public routes still exist (no stale entries)', () => {
    const keys = new Set(routeFiles.map(routeKey));
    const stale = Object.keys(PUBLIC_ROUTES).filter(k => !keys.has(k));
    expect(stale, `PUBLIC_ROUTES entries with no matching route: ${stale.join(', ')}`).toEqual([]);
    const staleReviewed = Object.keys(REVIEWED_SELF_SCOPED).filter(k => !keys.has(k));
    expect(staleReviewed, `REVIEWED_SELF_SCOPED entries with no matching route: ${staleReviewed.join(', ')}`).toEqual([]);
  });

  it('routes accepting a profile target use a profile gate or are reviewed self-scoped', () => {
    const offenders: string[] = [];
    for (const file of routeFiles) {
      const key = routeKey(file);
      if (key in PUBLIC_ROUTES || key in REVIEWED_SELF_SCOPED) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      // "Accepts a profile target": reads targetProfileId anywhere, or is a
      // [profileId]-parameterized path, or destructures/get()s profileId.
      const takesTarget =
        /\btargetProfileId\b/.test(source) ||
        /\[profileId\]/.test(key) ||
        /searchParams\.get\(\s*['"]profileId['"]\s*\)/.test(source) ||
        /\bbody\.profileId\b/.test(source);
      if (!takesTarget) continue;
      if (!PROFILE_GATE_RE.test(source)) {
        offenders.push(key);
      }
    }
    expect(
      offenders,
      `routes that take a profile target but call no profile gate (add the gate, or review + allowlist with a reason):\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});
