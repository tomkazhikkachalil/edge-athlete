import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every write route meets the limiter (Nov 2 2026, the launch readiness
 * review; tightened Nov 7 2026, scale round 2 PR 2 — SCALE_AUDIT hole 8).
 *
 * Until the first pin, a route that gated on `getServerAuth` met NO bucket —
 * not even the shadow `write-general` that `requireAuth` spends — and nothing
 * said so. Until the second, a route that spent its OWN bucket beside a bare
 * `getServerAuth(request)` passed as "covered" though it never met
 * `write-general`, and a write handler with no limiter at all passed on the
 * text of a sibling handler in the same file.
 *
 * The rule, per WRITE HANDLER (the file is split at its exported methods):
 *   - a handler that authenticates with a bare `getServerAuth(request)` or a
 *     raw `.auth.getUser()` FAILS — the bucket rides on the auth call
 *     (`getServerAuth(request, { limit })`) or, for the documented custom
 *     gates, the handler calls `enforceRateLimitMany(request, ['write-general', …])`;
 *   - a handler naming one of the gates below is covered;
 *   - a handler with no auth call of its own (a shim, a local `handle()`, the
 *     match-write opener) is covered when its file, or a `@/lib` module it
 *     delegates to, names a gate.
 * A route that takes no account says why in ALLOWED.
 */
const ROOT = path.join(process.cwd(), 'src', 'app', 'api');
const LIB = path.join(process.cwd(), 'src', 'lib');
const HANDLER_RE = /^export (?:async )?function (GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\b/gm;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** A gate that spends write-general (alone, or with the route's bucket in the same trip). */
const MARKERS = [
  'getServerAuth(request, { limit',
  'requireAuth(request', 'requireActiveWriter(request',
  'requireAdmin(', 'requireModerator(', 'requireProfileRole(', 'requireGuardianAccount(',
  "enforceRateLimitMany(request, ['write-general'",
  'CRON_SECRET',
];
/** An auth call that spends nothing. */
const BARE_RE = /getServerAuth\(request\)(?!\s*,)|\.auth\.getUser\(\)/;

/** Routes that take no account and so no per-account bucket — each with its own gate. */
const ALLOWED: Record<string, string> = {
  'webhooks/polar': 'a signed webhook: the HMAC signature is the gate, there is no account to count',
  'profile/[profileId]/media': 'its POST is an optional-auth READ (the media counts for a profile), not a write',
  'athlete-claim/[token]': 'the accountless self-claim: IP-keyed `athlete-claim`; the guardian branch signs in inside',
  'contact': 'the public contact form: IP-keyed `contact`, a session is optional',
  'contacts': 'the public contact capture: IP-keyed `contacts`',
  'tickets/guest': 'a guest support ticket: IP-keyed `contact`',
  'posts/views': 'the impact beacon: IP-keyed `post-views`, answers 204 even when limited',
  'public/site-forms/[siteId]/[widgetId]': 'an org site form from the public web: IP-keyed `site-form` + `site-form-site`',
  'csp-report': 'the browser\'s CSP report sink: IP-keyed, no account',
  'activities/inbound/[token]': 'a connected device posting by token: `activity-inbound`, no session',
  'auth/username-login': 'signing in: IP-keyed `login`, there is no account yet',
  'auth/activate': 'activating an invited account: IP-keyed, sets the session cookies itself',
  'signup': 'creating an account: IP-keyed `signup`',
  'admin/session': 'the console sign-in and sign-out: the console cookie is the gate (Convention 48)',
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
};

const hasMarker = (src: string) => MARKERS.some(m => src.includes(m));

/** The file split at its exported handlers: [{ method, body }]. */
const handlers = (src: string): Array<{ method: string; body: string }> => {
  const out: Array<{ method: string; body: string }> = [];
  const starts = [...src.matchAll(HANDLER_RE)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index! : src.length;
    out.push({ method: m[1], body: src.slice(m.index!, end) });
  });
  return out;
};

/** The `@/lib/...` modules a file imports, resolved to their source files. */
const libImports = (src: string): string[] => {
  const out: string[] = [];
  for (const m of src.matchAll(/from '@\/lib\/([^']+)'/g)) {
    const base = path.join(LIB, m[1]);
    for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate)) { out.push(candidate); break; }
    }
  }
  return out;
};

/** One level of delegation: the shim's handler module, and that module's own gate helpers. */
const delegatesToGate = (src: string): boolean => {
  const seen = new Set<string>();
  const queue = libImports(src);
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const body = fs.readFileSync(next, 'utf8');
    if (hasMarker(body)) return true;
    if (seen.size < 12) queue.push(...libImports(body));
  }
  return false;
};

/** The write handlers of a file that meet no gate. */
const uncoveredHandlers = (file: string): string[] => {
  const src = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const h of handlers(src)) {
    if (!WRITE_METHODS.has(h.method)) continue;
    if (hasMarker(h.body)) continue;
    if (BARE_RE.test(h.body)) { out.push(h.method); continue; } // its own auth, spending nothing
    // No auth call of its own: a shim or a local helper — the file or the module it delegates to must gate.
    if (hasMarker(src) || delegatesToGate(src)) continue;
    out.push(h.method);
  }
  return out;
};

describe('every write route meets the limiter', () => {
  const routes = walk(ROOT).filter(f => handlers(fs.readFileSync(f, 'utf8')).some(h => WRITE_METHODS.has(h.method)));

  it('finds the write routes', () => {
    expect(routes.length).toBeGreaterThan(300);
  });

  it('every write handler names a gate that spends write-general, delegates to one, or its route says why not', () => {
    const uncovered = routes
      .map(f => ({ rel: path.relative(ROOT, path.dirname(f)), file: f }))
      .filter(({ rel }) => !(rel in ALLOWED))
      .flatMap(({ rel, file }) => uncoveredHandlers(file).map(m => `${rel} ${m}`));
    expect(uncovered, 'write handlers that meet no write-general — put the bucket on the auth call (getServerAuth(request, { limit }) / requireAuth({ limit })), or enforceRateLimitMany([\'write-general\', …]) on a custom gate, or a reason in ALLOWED').toEqual([]);
  });

  it('a bare enforceRateLimit beside a bare getServerAuth is NOT coverage (the Nov 7 tightening)', () => {
    const src = `export async function POST(request) {\n  const { user } = await getServerAuth(request);\n  const limited = await enforceRateLimit(request, 'x', { userId: user.id });\n}`;
    expect(hasMarker(src)).toBe(false);
    expect(BARE_RE.test(src)).toBe(true);
  });

  it('the allowlist names only routes that exist and are still write routes', () => {
    for (const rel of Object.keys(ALLOWED)) {
      const file = path.join(ROOT, rel, 'route.ts');
      expect(fs.existsSync(file), rel).toBe(true);
      expect(handlers(fs.readFileSync(file, 'utf8')).some(h => WRITE_METHODS.has(h.method)), rel).toBe(true);
    }
  });

  it('the routes this pin was written for each name their bucket', () => {
    for (const [rel, bucket] of Object.entries({
      'posts/save': 'post-save', 'handles/update': 'handle-update',
      'golf/scorecards': 'golf-score', 'golf/scorecards/[id]/scores': 'golf-score', 'golf/participant-scores': 'golf-score',
      'group-posts/[id]': 'group-post-edit', 'group-posts/[id]/attest': 'group-post-edit',
      'sport-events/[id]/cards/[pid]/submit': 'sport-event', 'settings/theme': 'settings-write',
      'profile/[profileId]/contest-media': 'result-visibility',
      // Nov 7 2026 (hole 8's remainder): the own-bucket routes folded onto the auth call.
      'comments': 'comment-create', 'group-posts': 'group-post-create', 'group-posts/[id]/participants': 'group-post-add',
      'push/subscriptions': 'push-subscribe', 'sport-events': 'sport-event', 'sport-events/[id]': 'sport-event',
      'sport-events/[id]/contest': 'sport-event', 'sport-events/[id]/participants/join': 'sport-event-join',
      'tags': 'tag-write', 'live/cheers': 'cheer',
    })) {
      const src = fs.readFileSync(path.join(ROOT, rel, 'route.ts'), 'utf8');
      expect(src, rel).toContain(`getServerAuth(request, { limit: '${bucket}' })`);
      expect(src, rel).toContain('if (limited) return limited;');
    }
    // The comment edit / moderation / delete handlers have their own budget.
    expect(fs.readFileSync(path.join(ROOT, 'comments/route.ts'), 'utf8').match(/getServerAuth\(request, \{ limit: 'comment-edit' \}\)/g)?.length).toBe(2);
    // The three match routes gate in one place.
    expect(fs.readFileSync(path.join(LIB, 'sport-events/match-write-server.ts'), 'utf8')).toContain("getServerAuth(request, { limit: 'sport-event' })");
    // The custom gates spend write-general in their one trip.
    for (const [rel, bucket] of Object.entries({ 'seen': 'seen', 'account/delete': 'account-delete', 'auth/change-password': 'reauth', 'auth/reauthenticate': 'reauth' })) {
      expect(fs.readFileSync(path.join(ROOT, rel, 'route.ts'), 'utf8'), rel).toContain(`enforceRateLimitMany(request, ['write-general', '${bucket}']`);
    }
    // The two typeaheads — GETs, a query per keystroke — spend people-search by account.
    for (const rel of ['mentions/search', 'calendar/invite-search']) {
      expect(fs.readFileSync(path.join(ROOT, rel, 'route.ts'), 'utf8'), rel).toContain("enforceRateLimit(request, 'people-search', { userId: user.id })");
    }
  });
});
