import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADMIN_COOKIE, ADMIN_SESSION_TTL_S, adminCookieOptions, safeAdminNext, validAdminClaims } from '../admin/session';
import { adminSecret, mintAdminToken, readAdminToken } from '../admin/session-server';

const SECRET = 'a-test-secret-that-is-long-enough-for-hs256-x';
const NOW = 1_800_000_000;
const user = { sub: '8f1e5c5e-2a4b-4c6d-9e8f-0a1b2c3d4e5f', email: 'Owner@Example.com', role: 'owner' as const };

describe('the admin cookie', () => {
  it('is HttpOnly, Strict, site-wide, and lives 12 h', () => {
    expect(ADMIN_COOKIE).toBe('ea_admin');
    expect(adminCookieOptions(true)).toEqual({ httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 12 * 3600 });
    expect(adminCookieOptions(false).secure).toBe(false);
  });
  it('mints and reads back; the claims carry the actor', async () => {
    const token = await mintAdminToken(user, SECRET, NOW);
    const claims = await readAdminToken(token, SECRET, NOW + 10);
    expect(claims).toMatchObject({ sub: user.sub, email: user.email, role: 'owner', iat: NOW, exp: NOW + ADMIN_SESSION_TTL_S });
  });
  it('refuses an expired, tampered or foreign token, and garbage', async () => {
    const token = await mintAdminToken(user, SECRET, NOW);
    expect(await readAdminToken(token, SECRET, NOW + ADMIN_SESSION_TTL_S + 1)).toBeNull();
    expect(await readAdminToken(`${token}x`, SECRET, NOW)).toBeNull();
    expect(await readAdminToken(token, `${SECRET}-other`, NOW)).toBeNull();
    const [h, , s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: user.sub, email: user.email, role: 'owner', iat: NOW, exp: NOW + 100, iss: 'edge-athlete-admin' })).toString('base64url')}.${s}`;
    expect(await readAdminToken(forged, SECRET, NOW)).toBeNull();
    expect(await readAdminToken(null, SECRET, NOW)).toBeNull();
    expect(await readAdminToken('short', SECRET, NOW)).toBeNull();
  });
  it('validAdminClaims refuses a lifetime longer than the TTL and a bad role', () => {
    expect(validAdminClaims({ ...user, iat: NOW, exp: NOW + 10 }, NOW)).toBe(true);
    expect(validAdminClaims({ ...user, iat: NOW, exp: NOW + ADMIN_SESSION_TTL_S + 1 }, NOW)).toBe(false);
    expect(validAdminClaims({ ...user, role: 'root', iat: NOW, exp: NOW + 10 }, NOW)).toBe(false);
    expect(validAdminClaims({ ...user, sub: 'not-a-uuid', iat: NOW, exp: NOW + 10 }, NOW)).toBe(false);
  });
  it('the secret must be set and long', () => {
    expect(adminSecret({})).toBeNull();
    expect(adminSecret({ ADMIN_SESSION_SECRET: 'short' })).toBeNull();
    expect(adminSecret({ ADMIN_SESSION_SECRET: SECRET })).toBe(SECRET);
  });
});

describe('safeAdminNext', () => {
  it('stays inside the console', () => {
    expect(safeAdminNext('/admin/contacts')).toBe('/admin/contacts');
    expect(safeAdminNext('/admin/tickets?x=1')).toBe('/admin/tickets?x=1');
    for (const bad of [undefined, null, '', '/feed', 'https://evil.example', '//evil.example', '/admin/login', '/admin/login?next=/x', '/admin\\evil', '/admin\nx']) {
      expect(safeAdminNext(bad), String(bad)).toBe('/admin');
    }
  });
});

describe('the gates take the cookie first', () => {
  const src = readFileSync(resolve(__dirname, '../auth-server.ts'), 'utf8');
  it('requireAdmin and requireModerator read the admin cookie and nothing else (B3)', () => {
    for (const fn of ['requireAdmin', 'requireModerator']) {
      const body = src.slice(src.indexOf(`export async function ${fn}(`));
      const call = body.slice(0, body.indexOf('\n}'));
      expect(call, fn).toContain('adminFromCookie(request)');
      expect(call, fn).toContain('requireConsoleCookie()');
      expect(call, fn).not.toContain('requireAuth(');
    }
  });
  it('the launch gate lets /admin through and the env documents the secret as server-only', () => {
    expect(readFileSync(resolve(__dirname, '../launch-gate.ts'), 'utf8')).toContain("'/admin'");
    const env = readFileSync(resolve(__dirname, '../../../.env.example'), 'utf8');
    expect(env).toMatch(/^# ADMIN_SESSION_SECRET=$/m);
    expect(env).not.toMatch(/NEXT_PUBLIC_ADMIN_SESSION_SECRET/);
  });
});
