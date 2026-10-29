import { describe, expect, it } from 'vitest';
import { COMING_SOON_PATH, GATED_ROBOTS, comingSoonSignInHref, gateReturnPath, isLaunchGateOn, launchGateRedirect } from '../launch-gate';

// The launch gate (Sep 30 2026): a signed-out visitor goes to the
// coming-soon page everywhere but the sign-in door, the auth callbacks, the
// password flows, the legal pages and static files. Since Oct 28 2026 the
// gate carries the way back: coming-soon gets `?next=<the path>` and its
// sign-in link passes it on to `/?signin=1&next=…`.

const gatedTo = (path: string) => `${COMING_SOON_PATH}?next=${encodeURIComponent(path)}`;

describe('launchGateRedirect (signed-out visitors while the gate is up)', () => {
  it('sends the app, the public profiles and the org sites to coming-soon, carrying the path as the way back', () => {
    for (const p of ['/feed', '/u/tom', '/athlete/x', '/org/kmha', '/kmha', '/org/kmha/standings', '/league/00000000-0000-4000-8000-000000000000/standings', '/register', '/help', '/activities/record', '/r/abc']) {
      expect(launchGateRedirect(p, ''), p).toBe(gatedTo(p));
    }
    // The path's own query travels with it.
    expect(launchGateRedirect('/feed', '?post=abc')).toBe(gatedTo('/feed?post=abc'));
    // The workout's door (Oct 9): an iPhone that dropped the session lands here first.
    expect(launchGateRedirect('/app/workout/00000000-0000-4000-8000-000000000001', '')).toBe(gatedTo('/app/workout/00000000-0000-4000-8000-000000000001'));
  });
  it('the root carries nothing — unless the app itself sent a ?next= there', () => {
    expect(launchGateRedirect('/', '')).toBe(COMING_SOON_PATH);
    expect(launchGateRedirect('/', '?next=%2Fapp%2Fworkout%2Fx')).toBe(gatedTo('/app/workout/x'));
    expect(launchGateRedirect('/', '?next=//evil.example')).toBe(COMING_SOON_PATH);
    expect(launchGateRedirect('/', '?next=https://evil.example')).toBe(COMING_SOON_PATH);
    expect(launchGateRedirect('/', '?next=/')).toBe(COMING_SOON_PATH);
  });
  it('lets the doors through: the sign-in query on /, the auth routes, the password flows, the legal pages', () => {
    expect(launchGateRedirect('/', '?signin=1')).toBeNull();
    expect(launchGateRedirect('/', '?signin=1&next=%2Fapp%2Fworkout%2Fx')).toBeNull();
    expect(launchGateRedirect('/', '?signin=0')).toBe(COMING_SOON_PATH);
    for (const p of [COMING_SOON_PATH, '/auth/callback', '/auth/complete-profile', '/forgot-password', '/reset-password', '/privacy', '/terms', '/admin', '/admin/login', '/admin/contacts']) {
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
    expect(launchGateRedirect('/robots.txt', '')).toBe(gatedTo('/robots.txt'));
    expect(launchGateRedirect('/sitemap.xml', '')).toBe(gatedTo('/sitemap.xml'));
  });
  it('is off unless NEXT_PUBLIC_LAUNCH_GATE is exactly "1"; the gated robots forbid everything', () => {
    expect(isLaunchGateOn({ NEXT_PUBLIC_LAUNCH_GATE: '1' })).toBe(true);
    expect(isLaunchGateOn({ NEXT_PUBLIC_LAUNCH_GATE: 'true' })).toBe(false);
    expect(isLaunchGateOn({})).toBe(false);
    expect(GATED_ROBOTS).toContain('Disallow: /');
  });
});

describe('the way back through the gate', () => {
  it('gateReturnPath keeps an internal path and refuses everything else', () => {
    expect(gateReturnPath('/app/workout/x')).toBe('/app/workout/x');
    expect(gateReturnPath('/feed?post=abc')).toBe('/feed?post=abc');
    for (const bad of [null, undefined, '', 'feed', '//evil.example', 'https://evil.example', '/', '/?signin=1']) {
      expect(gateReturnPath(bad), String(bad)).toBeNull();
    }
  });
  it('the coming-soon sign-in link is the one door, carrying the way back when there is one', () => {
    expect(comingSoonSignInHref(null)).toBe('/?signin=1');
    expect(comingSoonSignInHref('')).toBe('/?signin=1');
    expect(comingSoonSignInHref('//evil.example')).toBe('/?signin=1');
    expect(comingSoonSignInHref('/app/workout/x')).toBe('/?signin=1&next=%2Fapp%2Fworkout%2Fx');
  });
});
