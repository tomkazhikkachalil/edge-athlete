import { describe, expect, it } from 'vitest';
import { fetchStatLinePosts } from '../stat-line-posts';

// Gaps round (Sep 26 2026): the Stats card counts public lines for a
// stranger and every line on the owner's view.

function recordingClient(rows: unknown[]) {
  const eqs: Array<[string, unknown]> = [];
  const chain = {
    select: () => chain,
    eq: (col: string, v: unknown) => (eqs.push([col, v]), chain),
    not: () => chain,
    limit: async () => ({ data: rows.map(stats_data => ({ stats_data })), error: null }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal client double
  return { client: { from: () => chain } as any, eqs };
}

describe('fetchStatLinePosts', () => {
  it("a stranger's read is public only", async () => {
    const { client, eqs } = recordingClient([{ a: 1 }]);
    expect(await fetchStatLinePosts(client, 'p1', 'ice_hockey', 100)).toEqual([{ a: 1 }]);
    expect(eqs).toContainEqual(['visibility', 'public']);
    expect(eqs).toContainEqual(['profile_id', 'p1']);
    expect(eqs).toContainEqual(['sport_key', 'ice_hockey']);
  });

  it("the owner's view drops the visibility filter", async () => {
    const { client, eqs } = recordingClient([{ a: 1 }, { b: 2 }]);
    expect(await fetchStatLinePosts(client, 'p1', 'ice_hockey', 100, { includePrivate: true })).toHaveLength(2);
    expect(eqs.some(([c]) => c === 'visibility')).toBe(false);
  });

  it('includePrivate false is the stranger view', async () => {
    const { client, eqs } = recordingClient([]);
    await fetchStatLinePosts(client, 'p1', 'track_field', 200, { includePrivate: false });
    expect(eqs).toContainEqual(['visibility', 'public']);
  });
});
