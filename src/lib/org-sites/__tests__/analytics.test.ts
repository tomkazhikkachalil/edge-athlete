import { describe, expect, it } from 'vitest';
import { ANALYTICS_RETENTION_DAYS, PIXEL_GIF, analyticsPruneCutoffs, dayKeyUTC, isBotUA, optedOut, pathKey, refererPath, visitorHash } from '../analytics';

// Program 2, E (Sep 11 2026): the pure half of first-party analytics.

describe('site analytics', () => {
  it('the visitor mark is stable within a day, different across days and secrets, and never the ip or ua', () => {
    const a = visitorHash('s', '2026-09-11', '203.0.113.7', 'Mozilla/5.0');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorHash('s', '2026-09-11', '203.0.113.7', 'Mozilla/5.0')).toBe(a);
    expect(visitorHash('s', '2026-09-12', '203.0.113.7', 'Mozilla/5.0')).not.toBe(a);
    expect(visitorHash('t', '2026-09-11', '203.0.113.7', 'Mozilla/5.0')).not.toBe(a);
    expect(visitorHash('s', '2026-09-11', '203.0.113.8', 'Mozilla/5.0')).not.toBe(a);
    expect(a).not.toContain('203');
    expect(dayKeyUTC(new Date('2026-09-11T23:59:59Z'))).toBe('2026-09-11');
  });
  it('bots, blanks and opted-out browsers are never visitors', () => {
    expect(isBotUA('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBotUA('facebookexternalhit/1.1')).toBe(true);
    expect(isBotUA('curl/8.0')).toBe(true);
    expect(isBotUA(null)).toBe(true);
    expect(isBotUA('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')).toBe(false);
    const h = (m: Record<string, string>) => ({ get: (k: string) => m[k.toLowerCase()] ?? null });
    expect(optedOut(h({ 'sec-gpc': '1' }))).toBe(true);
    expect(optedOut(h({ dnt: '1' }))).toBe(true);
    expect(optedOut(h({}))).toBe(false);
  });
  it('the path key is the page under the site base: home "/", two segments at most, no query or hash, 80 chars at most', () => {
    expect(pathKey('/org/river', '/org/river')).toBe('/');
    expect(pathKey('/org/river/', '/org/river')).toBe('/');
    expect(pathKey('/org/river/standings', '/org/river')).toBe('/standings');
    expect(pathKey('/org/river/teams/abc/def', '/org/river')).toBe('/teams/abc');
    expect(pathKey('/river/about-us?x=1#y', '/river')).toBe('/about-us');
    expect(pathKey('/standings', '')).toBe('/standings'); // a custom domain: the base is empty
    expect(pathKey('/' + 'a'.repeat(200), '').length).toBe(80);
  });
  it('the referer must be same-origin and never a preview', () => {
    expect(refererPath('https://x.test/org/river/news', 'https://x.test')).toBe('/org/river/news');
    expect(refererPath('https://other.test/org/river', 'https://x.test')).toBeNull();
    expect(refererPath('https://x.test/org/river/preview/abc', 'https://x.test')).toBeNull();
    expect(refererPath(null, 'https://x.test')).toBeNull();
    expect(refererPath('not a url', 'https://x.test')).toBeNull();
  });
  it('the pixel is a 1x1 GIF; the cutoffs are 2 days for marks and 400 for daily rows', () => {
    expect(PIXEL_GIF.subarray(0, 6).toString('ascii')).toBe('GIF89a');
    expect(ANALYTICS_RETENTION_DAYS).toEqual({ marks: 2, daily: 400 });
    expect(analyticsPruneCutoffs(new Date('2026-09-11T12:00:00Z'))).toEqual({ marksBefore: '2026-09-09', dailyBefore: '2025-08-07' });
  });
});
