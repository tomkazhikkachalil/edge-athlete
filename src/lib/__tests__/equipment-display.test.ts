import { describe, it, expect } from 'vitest';
import {
  groupRetiredByYear, countByStatus, EARLIER_BUCKET,
  filterEquipmentBySearch, sortEquipment,
  buildEquipmentNav, equipmentAnchorId,
  filterEquipmentForView, partitionByGroupLabel,
} from '../equipment-display';

type Item = {
  id: string;
  status: 'active' | 'retired';
  acquired_on?: string | null;
  added_at?: string | null;
  retired_on?: string | null;
  retired_at?: string | null;
};

const retired = (id: string, retired_on: string | null, retired_at: string | null = null): Item => ({
  id, status: 'retired', retired_on, retired_at,
});

describe('groupRetiredByYear', () => {
  it('buckets by retirement year, newest year first', () => {
    const buckets = groupRetiredByYear([
      retired('a', '2023-05-01'),
      retired('b', '2025-01-10'),
      retired('c', '2023-11-30'),
    ]);
    expect(buckets.map(b => b.year)).toEqual([2025, 2023]);
    expect(buckets[1].items.map(i => i.id)).toEqual(['a', 'c']);
  });

  it('ignores active items entirely', () => {
    const buckets = groupRetiredByYear([
      { id: 'x', status: 'active' as const },
      retired('a', '2024-01-01'),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].items.map(i => i.id)).toEqual(['a']);
  });

  it('prefers the user date (retired_on) over the audit timestamp (retired_at)', () => {
    const buckets = groupRetiredByYear([retired('a', '2022-12-31', '2023-01-02')]);
    expect(buckets[0].year).toBe(2022);
  });

  it('falls back to retired_at when retired_on is missing', () => {
    const buckets = groupRetiredByYear([retired('a', null, '2021-06-15')]);
    expect(buckets[0].year).toBe(2021);
  });

  it('puts undated retired items in the trailing "earlier" bucket', () => {
    const buckets = groupRetiredByYear([
      retired('dated', '2024-03-01'),
      retired('undated', null),
    ]);
    expect(buckets.map(b => b.year)).toEqual([2024, EARLIER_BUCKET]);
    expect(buckets[1].items.map(i => i.id)).toEqual(['undated']);
  });

  it('returns [] for no retired items', () => {
    expect(groupRetiredByYear([{ id: 'x', status: 'active' as const }])).toEqual([]);
  });
});

describe('countByStatus', () => {
  it('counts both statuses', () => {
    expect(countByStatus([
      { status: 'active' }, { status: 'retired' }, { status: 'active' },
    ])).toEqual({ active: 2, retired: 1 });
  });

  it('handles empty input', () => {
    expect(countByStatus([])).toEqual({ active: 0, retired: 0 });
  });
});

describe('filterEquipmentBySearch', () => {
  const label = () => 'Driver';
  const items = [
    { id: 'a', status: 'active' as const, brand: 'Titleist', model: 'TSR3', category: 'driver', notes: 'gamer' },
    { id: 'b', status: 'active' as const, brand: 'PING', model: 'G430', category: 'driver', notes: null },
  ];

  it('passes everything through on an empty/whitespace query', () => {
    expect(filterEquipmentBySearch(items, '', label)).toHaveLength(2);
    expect(filterEquipmentBySearch(items, '   ', label)).toHaveLength(2);
  });

  it('matches brand, model, notes and the humanized category label, case-insensitively', () => {
    expect(filterEquipmentBySearch(items, 'titleist', label).map(i => i.id)).toEqual(['a']);
    expect(filterEquipmentBySearch(items, 'g43', label).map(i => i.id)).toEqual(['b']);
    expect(filterEquipmentBySearch(items, 'GAMER', label).map(i => i.id)).toEqual(['a']);
    expect(filterEquipmentBySearch(items, 'Driver', label)).toHaveLength(2);
  });

  it('returns [] when nothing matches', () => {
    expect(filterEquipmentBySearch(items, 'zebra', label)).toEqual([]);
  });
});

describe('sortEquipment', () => {
  const items = [
    { id: 'old', status: 'active' as const, brand: 'PING', model: 'G430', category: 'driver', acquired_on: '2022-01-01' },
    { id: 'new', status: 'active' as const, brand: 'Titleist', model: 'TSR3', category: 'driver', acquired_on: '2025-06-01' },
    { id: 'undated', status: 'active' as const, brand: 'Cobra', model: 'Aerojet', category: 'driver' },
  ];

  it('newest: acquisition date desc, undated last', () => {
    expect(sortEquipment(items, 'newest', () => 0).map(i => i.id)).toEqual(['new', 'old', 'undated']);
  });

  it('newest: falls back to added_at when acquired_on missing', () => {
    const withAudit = [
      { id: 'x', status: 'active' as const, brand: 'A', model: 'M', category: 'c', added_at: '2024-01-01' },
      { id: 'y', status: 'active' as const, brand: 'B', model: 'M', category: 'c', acquired_on: '2023-01-01' },
    ];
    expect(sortEquipment(withAudit, 'newest', () => 0).map(i => i.id)).toEqual(['x', 'y']);
  });

  it('brand: A-Z by brand, then model', () => {
    expect(sortEquipment(items, 'brand', () => 0).map(i => i.brand)).toEqual(['Cobra', 'PING', 'Titleist']);
  });

  it('category: caller-supplied rank, brand as tiebreak, and does not mutate input', () => {
    const rank = (i: { category: string }) => (i.category === 'driver' ? 0 : 1);
    const mixed = [...items, { id: 'p', status: 'active' as const, brand: 'Odyssey', model: 'White Hot', category: 'putter' }];
    const before = mixed.map(i => i.id);
    expect(sortEquipment(mixed, 'category', rank).map(i => i.id)).toEqual(['undated', 'old', 'new', 'p']);
    expect(mixed.map(i => i.id)).toEqual(before);
  });
});

describe('equipmentAnchorId', () => {
  it('slugs sport and category into stable ids', () => {
    expect(equipmentAnchorId('golf')).toBe('equip-golf');
    expect(equipmentAnchorId('golf', 'iron_set')).toBe('equip-golf-iron-set');
    expect(equipmentAnchorId('ice_hockey', 'Shin Guards!')).toBe('equip-ice-hockey-shin-guards');
  });
});

describe('buildEquipmentNav', () => {
  const opts = {
    sortedSportKeys: ['golf', 'soccer'],
    sportLabel: (s: string) => s.toUpperCase(),
    categoryLabel: (_s: string, c: string) => c.toUpperCase(),
    categoryRank: (_s: string, c: string) => ({ driver: 0, putter: 1 }[c] ?? Number.MAX_SAFE_INTEGER),
  };
  const item = (sport: string, category: string, status: 'active' | 'retired') => ({
    sport_key: sport, category, status,
    brand: 'B', model: 'M',
  });

  it('orders categories by injected rank, unknown free-text last alphabetically', () => {
    const nav = buildEquipmentNav([
      item('golf', 'putter', 'active'),
      item('golf', 'zzz_custom', 'active'),
      item('golf', 'aaa_custom', 'active'),
      item('golf', 'driver', 'active'),
    ], opts);
    expect(nav[0].categories.map(c => c.value)).toEqual(['driver', 'putter', 'aaa_custom', 'zzz_custom']);
  });

  it('counts only ACTIVE items per category and totals retired separately', () => {
    const nav = buildEquipmentNav([
      item('golf', 'driver', 'active'),
      item('golf', 'driver', 'active'),
      item('golf', 'driver', 'retired'),
      item('golf', 'putter', 'retired'),
    ], opts);
    expect(nav[0].categories).toHaveLength(1); // putter has no active items
    expect(nav[0].categories[0]).toMatchObject({ value: 'driver', count: 2 });
    expect(nav[0].retiredCount).toBe(2);
  });

  it('emits stable anchor ids that match equipmentAnchorId', () => {
    const nav = buildEquipmentNav([item('golf', 'driver', 'active')], opts);
    expect(nav[0].anchorId).toBe(equipmentAnchorId('golf'));
    expect(nav[0].categories[0].anchorId).toBe(equipmentAnchorId('golf', 'driver'));
    expect(nav[0].historyAnchorId).toBe('equip-golf-history');
  });

  it('follows the caller-provided sport order', () => {
    const nav = buildEquipmentNav([
      item('soccer', 'cleats', 'active'),
      item('golf', 'driver', 'active'),
    ], opts);
    expect(nav.map(s => s.sportKey)).toEqual(['golf', 'soccer']);
    expect(nav.map(s => s.label)).toEqual(['GOLF', 'SOCCER']);
  });
});

describe('filterEquipmentForView', () => {
  const item = (over: Partial<Item> & { id: string }): Item => ({
    status: 'active', ...over,
  });

  it("'now' is the identity", () => {
    const items = [item({ id: 'a' }), item({ id: 'b', status: 'retired' })];
    expect(filterEquipmentForView(items, 'now')).toBe(items);
  });

  it('a year keeps gear in the bag that season, INCLUDING retired-since', () => {
    const items = [
      item({ id: 'kept', acquired_on: '2023-02-01' }),                                   // still active
      item({ id: 'retired-later', status: 'retired', acquired_on: '2022-01-01', retired_on: '2025-01-01' }),
      item({ id: 'after', acquired_on: '2025-03-01' }),                                  // acquired after
      item({ id: 'before', status: 'retired', acquired_on: '2020-01-01', retired_on: '2022-06-01' }),
    ];
    expect(filterEquipmentForView(items, 2024).map(i => i.id)).toEqual(['kept', 'retired-later']);
  });

  it('boundary years count (acquired or retired mid-year)', () => {
    const items = [
      item({ id: 'x', status: 'retired', acquired_on: '2024-06-15', retired_on: '2024-08-01' }),
    ];
    expect(filterEquipmentForView(items, 2024).map(i => i.id)).toEqual(['x']);
    expect(filterEquipmentForView(items, 2023)).toEqual([]);
    expect(filterEquipmentForView(items, 2025)).toEqual([]);
  });

  it('undated retired items match NO year (History "Earlier" is their only home)', () => {
    const items = [item({ id: 'ghost', status: 'retired' })];
    expect(filterEquipmentForView(items, 2024)).toEqual([]);
    expect(filterEquipmentForView(items, 2026)).toEqual([]);
  });

  it('falls back to audit timestamps when user dates are missing', () => {
    const items = [item({ id: 'legacy', status: 'retired', added_at: '2023-05-01', retired_at: '2024-02-01' })];
    expect(filterEquipmentForView(items, 2023).map(i => i.id)).toEqual(['legacy']);
    expect(filterEquipmentForView(items, 2024).map(i => i.id)).toEqual(['legacy']);
  });
});

describe('partitionByGroupLabel', () => {
  const gear = (id: string, group_label?: string | null) => ({
    id, status: 'active' as const, brand: 'B', model: 'M', category: 'driver', group_label,
  });

  it('splits labeled items into label-ordered sets; unlabeled fall through', () => {
    const { sets, rest } = partitionByGroupLabel('golf', [
      gear('a', 'Winter setup'),
      gear('b'),
      gear('c', 'Tournament bag'),
      gear('d', 'Tournament bag'),
      gear('e', null),
    ]);
    expect(sets.map(s => s.label)).toEqual(['Tournament bag', 'Winter setup']);
    expect(sets[0].items.map(i => i.id)).toEqual(['c', 'd']);
    expect(rest.map(i => i.id)).toEqual(['b', 'e']);
  });

  it('trim-matches labels case-insensitively, preserving first-seen casing', () => {
    const { sets } = partitionByGroupLabel('golf', [
      gear('a', 'Tournament Bag '),
      gear('b', ' tournament bag'),
    ]);
    expect(sets).toHaveLength(1);
    expect(sets[0].label).toBe('Tournament Bag');
    expect(sets[0].items).toHaveLength(2);
  });

  it('emits stable set anchors', () => {
    const { sets } = partitionByGroupLabel('golf', [gear('a', 'Tournament bag')]);
    expect(sets[0].anchorId).toBe('equip-golf-set-tournament-bag');
  });
});

describe('buildEquipmentNav custom sets', () => {
  const opts = {
    sortedSportKeys: ['golf'],
    sportLabel: (s: string) => s,
    categoryLabel: (_s: string, c: string) => c,
    categoryRank: () => 0,
  };

  it('labeled active items become set entries and leave their category counts', () => {
    const nav = buildEquipmentNav([
      { sport_key: 'golf', category: 'driver', status: 'active' as const, brand: 'B', model: 'M', group_label: 'Tournament bag' },
      { sport_key: 'golf', category: 'driver', status: 'active' as const, brand: 'B', model: 'M2' },
      { sport_key: 'golf', category: 'putter', status: 'retired' as const, brand: 'B', model: 'M3', group_label: 'Tournament bag' },
    ], opts);
    expect(nav[0].sets).toEqual([
      { value: 'Tournament bag', label: 'Tournament bag', count: 1, anchorId: 'equip-golf-set-tournament-bag' },
    ]);
    expect(nav[0].categories).toEqual([
      { value: 'driver', label: 'driver', count: 1, anchorId: 'equip-golf-driver' },
    ]);
  });
});
