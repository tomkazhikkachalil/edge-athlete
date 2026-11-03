import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every write route meets the limiter (Nov 2 2026, the launch readiness
 * review). Until this pin, a route that gated on `getServerAuth` met NO
 * bucket — not even the shadow `write-general` that `requireAuth` spends —
 * and nothing said so. A write route is covered when it, or a `@/lib`
 * module it delegates to (the org shims, the match-write opener, the
 * guardian gates), names one of the gates below. A route that must stay
 * out says why in ALLOWED.
 */
const ROOT = path.join(process.cwd(), 'src', 'app', 'api');
const LIB = path.join(process.cwd(), 'src', 'lib');
const WRITE_RE = /export (?:async )?function (?:POST|PUT|PATCH|DELETE)\b/;
const MARKERS = [
  'requireAuth(', 'requireActiveWriter(', 'requireAdmin(', 'requireModerator(',
  'requireProfileRole(', 'requireGuardianAccount(',
  'enforceRateLimit(', 'enforceRateLimitMany(',
  'getServerAuth(request, { limit', 'CRON_SECRET',
];

/** Routes that take no account and so no per-account bucket — each with its own gate. */
const ALLOWED: Record<string, string> = {
  'webhooks/polar': 'a signed webhook: the HMAC signature is the gate, there is no account to count',
  'profile/[profileId]/media': 'its POST is an optional-auth READ (the media counts for a profile), not a write',
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

const covered = (file: string): boolean => {
  const src = fs.readFileSync(file, 'utf8');
  if (hasMarker(src)) return true;
  // One level of delegation: the shim's handler module, and that module's own gate helpers.
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

describe('every write route meets the limiter', () => {
  const routes = walk(ROOT).filter(f => WRITE_RE.test(fs.readFileSync(f, 'utf8')));

  it('finds the write routes', () => {
    expect(routes.length).toBeGreaterThan(300);
  });

  it('names a gate, delegates to one, or says why not', () => {
    const uncovered = routes
      .map(f => path.relative(ROOT, path.dirname(f)))
      .filter(rel => !(rel in ALLOWED))
      .filter(rel => !covered(path.join(ROOT, rel, 'route.ts')));
    expect(uncovered, 'write routes with no limiter — give each a bucket (getServerAuth(request, { limit }) or requireAuth({ limit })) or a reason in ALLOWED').toEqual([]);
  });

  it('the allowlist names only routes that exist and are still write routes', () => {
    for (const rel of Object.keys(ALLOWED)) {
      const file = path.join(ROOT, rel, 'route.ts');
      expect(fs.existsSync(file), rel).toBe(true);
      expect(WRITE_RE.test(fs.readFileSync(file, 'utf8')), rel).toBe(true);
    }
  });

  it('the routes this pin was written for each name their bucket', () => {
    for (const [rel, bucket] of Object.entries({
      'posts/save': 'post-save', 'handles/update': 'handle-update',
      'golf/scorecards': 'golf-score', 'golf/scorecards/[id]/scores': 'golf-score', 'golf/participant-scores': 'golf-score',
      'group-posts/[id]': 'group-post-edit', 'group-posts/[id]/attest': 'group-post-edit',
      'sport-events/[id]/cards/[pid]/submit': 'sport-event', 'settings/theme': 'settings-write',
      'profile/[profileId]/contest-media': 'result-visibility',
    })) {
      const src = fs.readFileSync(path.join(ROOT, rel, 'route.ts'), 'utf8');
      expect(src, rel).toContain(`getServerAuth(request, { limit: '${bucket}' })`);
      expect(src, rel).toContain('if (limited) return limited;');
    }
  });
});
