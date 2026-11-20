import { describe, it, expect, vi, afterEach } from 'vitest';
import { BUDGET_WINDOW_MS, usageRow } from '../provider-usage';
import { readProviderUsage } from '../provider-usage-server';

// Nov 20 2026: the admin readout of each golf provider's daily counter.
const NOW = Date.parse('2026-11-20T18:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('usageRow: one provider\'s counter beside its limit', () => {
  it('no counter yet: nothing used and no window', () => {
    expect(usageRow('golfcourseapi', 9000, null, NOW)).toEqual({ source: 'golfcourseapi', limit: 9000, used: 0, refused: 0, resetsAt: null, state: 'idle' });
  });

  it('a window in progress: the count, and the reset 24 hours after its first hit', () => {
    expect(usageRow('golfcourseapi', 9000, { count: 17, window_start: hoursAgo(5) }, NOW)).toEqual({
      source: 'golfcourseapi', limit: 9000, used: 17, refused: 0, resetsAt: new Date(NOW + 19 * 3600_000).toISOString(), state: 'open',
    });
  });

  it('a counter older than a day is stale until its next hit: it reads as nothing used', () => {
    expect(usageRow('overpass', 200, { count: 29, window_start: hoursAgo(30) }, NOW)).toMatchObject({ used: 0, resetsAt: null, state: 'idle' });
    expect(usageRow('overpass', 200, { count: 29, window_start: new Date(NOW - BUDGET_WINDOW_MS + 1).toISOString() }, NOW).state).toBe('open');
  });

  it('refused hits still count: the readout never shows more than the limit', () => {
    expect(usageRow('opengolfapi', 1000, { count: 1000, window_start: hoursAgo(2) }, NOW)).toMatchObject({ used: 1000, refused: 0, state: 'reached' });
    expect(usageRow('opengolfapi', 1000, { count: 1042, window_start: hoursAgo(2) }, NOW)).toMatchObject({ used: 1000, refused: 42, state: 'reached' });
  });

  it('a window_start that is not a date is no window', () => {
    expect(usageRow('x', 45, { count: 3, window_start: 'nope' }, NOW).state).toBe('idle');
  });
});

describe('the limit in force', () => {
  it('GolfCourseAPI\'s comes from GOLF_PROVIDER_DAILY_BUDGET, else 45; an unnamed source gets 45', async () => {
    vi.stubEnv('GOLF_PROVIDER_DAILY_BUDGET', '9000');
    vi.resetModules();
    const set = await import('../course-catalog');
    expect(set.providerBudgetLimit('golfcourseapi')).toBe(9000);
    expect(set.providerBudgetLimit('opengolfapi')).toBe(1000);
    expect(set.providerBudgetLimit('never-heard-of-it')).toBe(45);
    expect(set.providerBudgetSources()).toEqual(expect.arrayContaining(['golfcourseapi', 'opengolfapi', 'card-fill', 'site-card', 'sweep-overpass']));

    vi.stubEnv('GOLF_PROVIDER_DAILY_BUDGET', '');
    vi.resetModules();
    expect((await import('../course-catalog')).providerBudgetLimit('golfcourseapi')).toBe(45);
  });
});

describe('readProviderUsage', () => {
  const adminWith = (rows: unknown[] | null, error: { message: string } | null = null) => {
    const asked: string[] = [];
    const admin = { from: (t: string) => ({ select: () => ({ like: async (_c: string, pattern: string) => { asked.push(`${t}:${pattern}`); return { data: rows, error }; } }) }) };
    return { admin: admin as never, asked };
  };

  it('one read of the golf counters; every named source has a row, counters with no named limit too', async () => {
    const { admin, asked } = adminWith([
      { key: 'golf-provider:golfcourseapi', count: 17, window_start: hoursAgo(1) },
      { key: 'golf-provider:mystery', count: 2, window_start: hoursAgo(1) },
    ]);
    const r = await readProviderUsage(admin, NOW);
    expect(asked).toEqual(['rate_limits:golf-provider:%']);
    expect(r.providers.find(p => p.source === 'golfcourseapi')).toMatchObject({ used: 17, state: 'open' });
    expect(r.providers.find(p => p.source === 'opengolfapi')).toMatchObject({ used: 0, state: 'idle', limit: 1000 });
    expect(r.providers.find(p => p.source === 'mystery')).toMatchObject({ used: 2, limit: 45 });
    expect(r.skipped).toEqual([]);
    expect(r.readAt).toBe(new Date(NOW).toISOString());
  });

  it('a read that fails throws: the route answers an error, never an empty table', async () => {
    await expect(readProviderUsage(adminWith(null, { message: 'boom' }).admin, NOW)).rejects.toThrow('boom');
  });
});
