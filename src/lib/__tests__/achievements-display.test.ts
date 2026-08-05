import { describe, it, expect } from 'vitest';
import {
  parsePlacement, tierRank, achievementStats, topFinishes, groupByYear, topPills,
} from '../achievements/display';
import type { Achievement } from '../achievements';

let idCounter = 0;
const ach = (over: Partial<Achievement> = {}): Achievement => ({
  id: `a${++idCounter}`,
  profile_id: 'p1',
  title: 'Achievement',
  description: null,
  sport_key: 'golf',
  achieved_on: '2026-06-15',
  organization: null,
  placement: null,
  created_at: '2026-06-15T00:00:00Z',
  updated_at: '2026-06-15T00:00:00Z',
  ...over,
});

describe('parsePlacement', () => {
  const cases: Array<[string | null, ReturnType<typeof parsePlacement>]> = [
    ['1st Place', 'gold'],
    ['First', 'gold'],
    ['State Champion', 'gold'],
    ['Champions', 'gold'],
    ['Winner', 'gold'],
    ['Won the final', 'gold'],
    ['2nd Place', 'silver'],
    ['Second', 'silver'],
    ['Runner-Up', 'silver'],
    ['Runner up', 'silver'],
    ['3rd', 'bronze'],
    ['Third Place', 'bronze'],
    ['T-1', 'gold'],
    ['T2', 'silver'],
    ['T-3', 'bronze'],
    ['T-4', null],
    ['T-12', null],
    ['Gold Medal', 'gold'],
    ['Silver', 'silver'],
    ['Bronze Medal', 'bronze'],
    ['Medalist', 'podium'],
    ['Podium', 'podium'],
    // Honors, not finishes — the guard must win over the rank words.
    ['1st Team All-State', null],
    ['First Team All-Conference', null],
    ['All-American', null],
    ['All-Region First Team', null],
    ['2nd Team All-League', null],
    // Ambiguous / non-podium.
    ['Championship Qualifier', null],
    ['Finalist', null],
    ['Top 10', null],
    ['Honorable Mention', null],
    ['Qualifier', null],
    ['', null],
    ['   ', null],
    [null, null],
  ];

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(parsePlacement(input)).toBe(expected);
    });
  }
});

describe('tierRank', () => {
  it('orders gold < silver < bronze < podium < null', () => {
    expect(tierRank('gold')).toBeLessThan(tierRank('silver'));
    expect(tierRank('silver')).toBeLessThan(tierRank('bronze'));
    expect(tierRank('bronze')).toBeLessThan(tierRank('podium'));
    expect(tierRank('podium')).toBeLessThan(tierRank(null));
  });
});

describe('achievementStats', () => {
  it('returns zeros and null years for an empty list', () => {
    expect(achievementStats([])).toEqual({
      total: 0, podiums: 0, organizations: 0, yearsActive: 0,
      firstYear: null, lastYear: null,
    });
  });

  it('counts podiums, distinct orgs (case-insensitive), and distinct years', () => {
    const stats = achievementStats([
      ach({ placement: '1st Place', organization: 'USGA', achieved_on: '2024-05-01' }),
      ach({ placement: 'Runner-Up', organization: 'usga ', achieved_on: '2025-05-01' }),
      ach({ placement: 'Finalist', organization: 'NCAA', achieved_on: '2025-08-01' }),
      ach({ placement: null, organization: null, achieved_on: '2026-01-01' }),
    ]);
    expect(stats).toEqual({
      total: 4, podiums: 2, organizations: 2, yearsActive: 3,
      firstYear: 2024, lastYear: 2026,
    });
  });

  it('ignores empty-string organizations', () => {
    expect(achievementStats([ach({ organization: '  ' })]).organizations).toBe(0);
  });
});

describe('topFinishes', () => {
  it('keeps podiums only, best tier first, then most recent', () => {
    const bronzeNew = ach({ placement: 'T-3', achieved_on: '2026-07-01' });
    const goldOld = ach({ placement: 'Champion', achieved_on: '2024-01-01' });
    const goldNew = ach({ placement: '1st Place', achieved_on: '2026-06-01' });
    const silver = ach({ placement: '2nd', achieved_on: '2025-06-01' });
    const honor = ach({ placement: '1st Team All-State', achieved_on: '2026-08-01' });
    const result = topFinishes([bronzeNew, goldOld, goldNew, silver, honor]);
    expect(result.map((a) => a.id)).toEqual([goldNew.id, goldOld.id, silver.id, bronzeNew.id]);
  });

  it('caps the result', () => {
    const list = ['1st', '1st', '2nd', '3rd', 'Gold'].map((p, i) =>
      ach({ placement: p, achieved_on: `2026-0${i + 1}-01` }));
    expect(topFinishes(list, 2)).toHaveLength(2);
  });

  it('is empty when nothing is a podium', () => {
    expect(topFinishes([ach({ placement: 'Finalist' }), ach()])).toEqual([]);
  });
});

describe('groupByYear', () => {
  it('groups newest year first and preserves incoming order within a year', () => {
    const a = ach({ achieved_on: '2025-11-01' });
    const b = ach({ achieved_on: '2025-03-01' });
    const c = ach({ achieved_on: '2024-06-01' });
    const groups = groupByYear([a, b, c]);
    expect(groups.map((g) => g.year)).toEqual([2025, 2024]);
    expect(groups[0].items.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(groups[1].items.map((x) => x.id)).toEqual([c.id]);
  });

  it('returns an empty array for an empty list', () => {
    expect(groupByYear([])).toEqual([]);
  });
});

describe('topPills', () => {
  it('ranks podiums before non-podiums, then by recency, and maps fields', () => {
    const honor = ach({ title: 'All-State', placement: '1st Team All-State', achieved_on: '2026-08-01' });
    const gold = ach({ title: 'State Am', placement: '1st Place', achieved_on: '2024-05-01' });
    const recent = ach({ title: 'Spring Invite', placement: null, achieved_on: '2026-03-01' });
    const pills = topPills([honor, gold, recent], 2);
    expect(pills).toEqual([
      { id: gold.id, title: 'State Am', tier: 'gold', year: 2024 },
      { id: honor.id, title: 'All-State', tier: null, year: 2026 },
    ]);
  });

  it('does not mutate the input order', () => {
    const first = ach({ placement: null, achieved_on: '2026-01-01' });
    const second = ach({ placement: '1st', achieved_on: '2024-01-01' });
    const list = [first, second];
    topPills(list, 2);
    expect(list.map((a) => a.id)).toEqual([first.id, second.id]);
  });
});
