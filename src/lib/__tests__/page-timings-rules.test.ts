import { describe, it, expect } from 'vitest';
import { BEACON_BATCH_MS, MAX_ROWS_PER_BEACON, TIMINGS_RETENTION_DAYS, cleanBuild, deviceClass, maskRoute, p75, readPageTimingsPayload, summarizeByBuild } from '../observability/page-timings-rules';

/** Real-user page timings rules (performance program Phase 0.4, Nov 2026). */
describe('page timings — what a row may say', () => {
  it('masks ids, handles and org slugs out of the route and drops the query', () => {
    expect(maskRoute('/athlete/3f9b1c2d-1111-2222-3333-444455556666?tab=media')).toBe('/athlete/:id');
    expect(maskRoute('/u/jane-doe')).toBe('/u/:handle');
    expect(maskRoute('/league/eagle-creek/standings')).toBe('/league/:id/standings');
    expect(maskRoute('/feed')).toBe('/feed');
    expect(maskRoute('')).toBe('/');
  });
  it('classes the device by viewport, never the user agent', () => {
    expect(deviceClass(375)).toBe('phone');
    expect(deviceClass(800)).toBe('tablet');
    expect(deviceClass(1280)).toBe('desktop');
    expect(deviceClass(NaN)).toBe('desktop');
  });
  it('cleans the build like the service worker does', () => {
    expect(cleanBuild('abc123def456')).toBe('abc123def456');
    expect(cleanBuild('../x')).toBe('x');
    expect(cleanBuild(7)).toBeNull();
    expect(cleanBuild('')).toBeNull();
  });
});

describe('page timings — the beacon body', () => {
  const body = { build: 'c8011bbd', route: '/athlete/3f9b1c2d-1111-2222-3333-444455556666', device: 'phone', navigation: 'navigate', metrics: [
    { name: 'LCP', value: 1234.5678, rating: 'good' },
    { name: 'CLS', value: 0.0123 },
    { name: 'BOGUS', value: 1 },
    { name: 'INP', value: -5 },
    { name: 'TTFB', value: 999_999 },
  ] };
  it('keeps the good rows, drops the bad ones, masks the route, rounds the value, carries nothing about a person', () => {
    const rows = readPageTimingsPayload(body, true)!;
    expect(rows.map((r) => r.metric)).toEqual(['LCP', 'CLS']);
    expect(rows[0]).toEqual({ build: 'c8011bbd', route: '/athlete/:id', metric: 'LCP', value: 1234.568, rating: 'good', device: 'phone', navigation: 'navigate', signed_in: true });
    expect(Object.keys(rows[0]).sort()).toEqual(['build', 'device', 'metric', 'navigation', 'rating', 'route', 'signed_in', 'value']);
  });
  it('refuses a body that is not a page timings payload and caps the batch', () => {
    expect(readPageTimingsPayload(null, false)).toBeNull();
    expect(readPageTimingsPayload({ route: '/x', metrics: [] }, false)).toBeNull();
    const many = { ...body, metrics: Array.from({ length: 50 }, () => ({ name: 'LCP', value: 1 })) };
    expect(readPageTimingsPayload(many, false)!.length).toBe(MAX_ROWS_PER_BEACON);
  });
  it('the constants: a 2 s batch, 30 days kept', () => {
    expect(BEACON_BATCH_MS).toBe(2_000);
    expect(TIMINGS_RETENTION_DAYS).toBe(30);
  });
});

describe('page timings — the admin card\'s numbers', () => {
  it('p75 is the value three quarters of samples sit under', () => {
    expect(p75([])).toBeNull();
    expect(p75([100])).toBe(100);
    expect(p75([1, 2, 3, 4])).toBe(3);
    expect(p75([5, 1, 4, 2, 3, 6, 7, 8])).toBe(6);
  });
  it('summarizes per build, newest first, p75 per device and metric', () => {
    const row = (build: string, at: string, device: 'phone' | 'desktop', metric: 'LCP' | 'CLS', value: number) => ({ build, route: '/feed', metric, value, rating: null, device, navigation: null, signed_in: true, received_at: at });
    const s = summarizeByBuild([
      row('old', '2026-11-06T00:00:00Z', 'phone', 'LCP', 3000),
      row('new', '2026-11-07T10:00:00Z', 'phone', 'LCP', 1000),
      row('new', '2026-11-07T11:00:00Z', 'phone', 'LCP', 2000),
      row('new', '2026-11-07T11:00:00Z', 'desktop', 'CLS', 0.05),
    ]);
    expect(s.map((b) => b.build)).toEqual(['new', 'old']);
    expect(s[0].samples).toBe(3);
    expect(s[0].p75.phone.LCP).toBe(2000);
    expect(s[0].p75.desktop.CLS).toBe(0.05);
    expect(s[0].p75.desktop.LCP).toBeUndefined();
    expect(summarizeByBuild([row('a', '2026-11-07T00:00:00Z', 'phone', 'LCP', 1)], 0)).toEqual([]);
  });
});
