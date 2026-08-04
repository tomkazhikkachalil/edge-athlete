import { describe, it, expect } from 'vitest';
import {
  groupRetiredByYear, countByStatus, EARLIER_BUCKET,
  filterEquipmentBySearch, sortEquipment,
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
