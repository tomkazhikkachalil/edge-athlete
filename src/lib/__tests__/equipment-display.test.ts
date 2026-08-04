import { describe, it, expect } from 'vitest';
import { groupRetiredByYear, countByStatus, EARLIER_BUCKET } from '../equipment-display';

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
