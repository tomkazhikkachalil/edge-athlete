import { describe, expect, it, vi } from 'vitest';
import {
  deriveOrgSports,
  mostCommonSport,
  orderOrgSports,
  refreshLeagueSportCache,
} from '../sports';

type Admin = Parameters<typeof refreshLeagueSportCache>[0];

interface RecordedCall {
  table: string;
  op: string;
  payload?: unknown;
  filters: Record<string, unknown>;
}

function mockAdmin(results: Partial<Record<string, { data?: unknown; error?: { code: string; message?: string } | null }>>) {
  const calls: RecordedCall[] = [];
  const admin = {
    from(table: string) {
      const call: RecordedCall = { table, op: '', filters: {} };
      calls.push(call);
      const result = { data: null, error: null, ...(results[table] ?? {}) };
      const chain = {
        eq(col: string, val: unknown) {
          call.filters[col] = val;
          return chain;
        },
        select: () => chain,
        maybeSingle: async () => result,
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return {
        select: () => chain,
        update(payload: unknown) {
          call.op = 'update';
          call.payload = payload;
          return chain;
        },
      };
    },
  };
  return { admin: admin as unknown as Admin, calls };
}

const rows = (...keys: string[]) => keys.map(k => ({ sport_key: k }));

describe('mostCommonSport', () => {
  it('picks the most common; ties break alphabetically; empty → null', () => {
    expect(mostCommonSport(['golf', 'ice_hockey', 'ice_hockey'])).toBe('ice_hockey');
    expect(mostCommonSport(['soccer', 'basketball'])).toBe('basketball');
    expect(mostCommonSport([])).toBeNull();
  });
});

describe('orderOrgSports', () => {
  it('cached sport leads, division sports deduped and alphabetical after', () => {
    expect(orderOrgSports(['soccer', 'basketball', 'soccer'], 'golf'))
      .toEqual(['golf', 'basketball', 'soccer']);
    expect(orderOrgSports(['soccer', 'golf'], 'golf')).toEqual(['golf', 'soccer']);
    expect(orderOrgSports(['soccer'], null)).toEqual(['soccer']);
  });
});

describe('deriveOrgSports', () => {
  it('unions division sports with the cache, filtering the org column by side', async () => {
    const { admin, calls } = mockAdmin({ divisions: { data: rows('ice_hockey', 'golf') } });
    const sports = await deriveOrgSports(admin, { side: 'league', orgId: 'org-1' }, 'golf');
    expect(sports).toEqual(['golf', 'ice_hockey']);
    expect(calls[0]).toMatchObject({ table: 'divisions', filters: { league_id: 'org-1' } });
  });

  it('club side: no cache, club_id filter', async () => {
    const { admin, calls } = mockAdmin({ divisions: { data: rows('soccer') } });
    const sports = await deriveOrgSports(admin, { side: 'club', orgId: 'org-2' }, null);
    expect(sports).toEqual(['soccer']);
    expect(calls[0].filters).toEqual({ club_id: 'org-2' });
  });

  it('missing divisions table (pre-145) degrades to the cache alone', async () => {
    const { admin } = mockAdmin({ divisions: { error: { code: '42P01' } } });
    expect(await deriveOrgSports(admin, { side: 'league', orgId: 'org-1' }, 'golf')).toEqual(['golf']);
  });

  it('other read errors warn and degrade, never throw', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { admin } = mockAdmin({ divisions: { error: { code: '57014', message: 'boom' } } });
    expect(await deriveOrgSports(admin, { side: 'club', orgId: 'org-2' }, null)).toEqual([]);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('refreshLeagueSportCache', () => {
  it('cache no longer among division sports → most common wins', async () => {
    const { admin, calls } = mockAdmin({
      divisions: { data: rows('ice_hockey', 'ice_hockey', 'soccer') },
      leagues: { data: { id: 'lg-1', sport_key: 'golf' } },
    });
    const { error } = await refreshLeagueSportCache(admin, 'lg-1');
    expect(error).toBeNull();
    const update = calls.find(c => c.op === 'update');
    expect(update?.table).toBe('leagues');
    expect(update?.payload).toEqual({ sport_key: 'ice_hockey' });
    expect(update?.filters).toEqual({ id: 'lg-1' });
  });

  it('cache still among division sports → no write', async () => {
    const { admin, calls } = mockAdmin({
      divisions: { data: rows('golf', 'soccer') },
      leagues: { data: { id: 'lg-1', sport_key: 'golf' } },
    });
    const { error } = await refreshLeagueSportCache(admin, 'lg-1');
    expect(error).toBeNull();
    expect(calls.some(c => c.op === 'update')).toBe(false);
  });

  it('zero divisions → no-op (an empty structure never rewrites the cache)', async () => {
    const { admin, calls } = mockAdmin({ divisions: { data: [] } });
    const { error } = await refreshLeagueSportCache(admin, 'lg-1');
    expect(error).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('read error is returned, not thrown, and nothing is written', async () => {
    const { admin, calls } = mockAdmin({ divisions: { error: { code: '57014' } } });
    const { error } = await refreshLeagueSportCache(admin, 'lg-1');
    expect(error).toEqual({ code: '57014' });
    expect(calls.some(c => c.op === 'update')).toBe(false);
  });
});
