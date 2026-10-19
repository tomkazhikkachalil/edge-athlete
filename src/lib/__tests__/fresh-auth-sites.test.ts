import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Speed round 2 (Oct 4 2026): the gates verify the session LOCALLY from the
 * access token and memoize per request. The places that must still take the
 * NETWORK user — `{ fresh: true }` — are pinned here, because forgetting one
 * is silent:
 *   - the write gate (a ban or a moderation state must bite at once),
 *   - the admin and moderator gates,
 *   - the two routes that read account fields the token does not carry.
 * And the middleware no longer reads profiles on a document load.
 */
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('the network user is taken where it must be', () => {
  it('the write gate passes fresh: true; the admin and moderator gates read the console cookie only (B3, Oct 19 2026)', () => {
    const src = read('src/lib/auth-server.ts');
    const body = src.slice(src.indexOf('export async function requireActiveWriter('));
    expect(body.slice(0, body.indexOf('\n}'))).toMatch(/requireAuth\(request, \{ fresh: true \}\)/);
    for (const fn of ['requireAdmin', 'requireModerator']) {
      const gate = src.slice(src.indexOf(`export async function ${fn}(`));
      const call = gate.slice(0, gate.indexOf('\n}'));
      expect(call, fn).toContain('adminFromCookie(request)');
      expect(call, fn).not.toContain('requireAuth(');
    }
  });

  it('the two account-field routes pass fresh: true', () => {
    for (const rel of ['src/app/api/auth/complete-profile/route.ts', 'src/app/api/invites/[token]/claim/route.ts']) {
      expect(read(rel), rel).toMatch(/requireAuth\(request, \{ fresh: true \}\)/);
    }
  });

  it('the middleware never reads profiles — the theme cookie is the client\'s and the theme route\'s', () => {
    const src = read('src/middleware.ts');
    expect(src).not.toContain(".from('profiles')");
    expect(src).toContain('verifySessionLocally');
    expect(read('src/app/api/settings/theme/route.ts')).toContain('response.cookies.set');
  });

  it('the secret is documented as server-only and optional', () => {
    const env = read('.env.example');
    expect(env).toMatch(/^SUPABASE_JWT_SECRET=$/m);
    expect(env).not.toMatch(/NEXT_PUBLIC_SUPABASE_JWT_SECRET/);
  });
});
