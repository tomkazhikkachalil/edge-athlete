import { describe, expect, it } from 'vitest';
import { COMING_SOON_PATH, GATED_ROBOTS, isLaunchGateOn, launchGateRedirect } from '../launch-gate';

// The launch gate (Sep 30 2026): a signed-out visitor goes to the
// coming-soon page everywhere but the sign-in door, the auth callbacks, the
// password flows, the legal pages and static files.

describe('launchGateRedirect (signed-out visitors while the gate is up)', () => {
  it('sends the app, the public profiles and the org sites to coming-soon', () => {
    for (const p of ['/', '/feed', '/u/tom', '/athlete/x', '/org/kmha', '/kmha', '/org/kmha/standings', '/league/00000000-0000-4000-8000-000000000000/standings', '/register', '/help', '/activities/import', '/activities/record', '/r/abc']) {
      expect(launchGateRedirect(p, ''), p).toBe(COMING_SOON_PATH);
    }
  });
  it('lets the doors through: the sign-in query on /, the auth routes, the password flows, the legal pages', () => {
    expect(launchGateRedirect('/', '?signin=1')).toBeNull();
    expect(launchGateRedirect('/', '?signin=0')).toBe(COMING_SOON_PATH);
    for (const p of [COMING_SOON_PATH, '/auth/callback', '/auth/complete-profile', '/forgot-password', '/reset-password', '/privacy', '/terms']) {
      expect(launchGateRedirect(p, ''), p).toBeNull();
    }
  });
  it('lets static files through but never the crawler files (the middleware answers those)', () => {
    expect(launchGateRedirect('/logo-mark.png', '')).toBeNull();
    expect(launchGateRedirect('/fonts/x.woff2', '')).toBeNull();
    // "Download the app": a signed-out phone must still read the manifest
    // and its icons, or the home-screen icon is a screenshot of a page.
    expect(launchGateRedirect('/manifest.webmanifest', '')).toBeNull();
    expect(launchGateRedirect('/apple-touch-icon.png', '')).toBeNull();
    expect(launchGateRedirect('/robots.txt', '')).toBe(COMING_SOON_PATH);
    expect(launchGateRedirect('/sitemap.xml', '')).toBe(COMING_SOON_PATH);
  });
  it('is off unless NEXT_PUBLIC_LAUNCH_GATE is exactly "1"; the gated robots forbid everything', () => {
    expect(isLaunchGateOn({ NEXT_PUBLIC_LAUNCH_GATE: '1' })).toBe(true);
    expect(isLaunchGateOn({ NEXT_PUBLIC_LAUNCH_GATE: 'true' })).toBe(false);
    expect(isLaunchGateOn({})).toBe(false);
    expect(GATED_ROBOTS).toContain('Disallow: /');
  });
});
