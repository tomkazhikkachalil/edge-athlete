import { describe, it, expect } from 'vitest';
import {
  yearOf,
  deriveYearOptions,
  isInBagDuringYear,
  deriveInBagYearOptions,
  matchesYearFilter,
  matchesSportFilter,
  formatMonthYear,
  GENERAL_SPORT_KEY,
} from '../profile-filters';

describe('yearOf', () => {
  it('reads the year from a DATE string regardless of machine timezone', () => {
    // new Date('2024-01-01').getFullYear() === 2023 in western TZs — the
    // string-slice implementation must never exhibit that shift.
    expect(yearOf('2024-01-01')).toBe(2024);
    expect(yearOf('2024-12-31')).toBe(2024);
  });

  it('handles full ISO timestamps', () => {
    expect(yearOf('2023-06-15T23:59:59.000Z')).toBe(2023);
  });
});

describe('deriveYearOptions', () => {
  it('dedupes and sorts newest first', () => {
    expect(deriveYearOptions(['2022-01-01', '2024-05-05', '2022-12-31', '2023-03-03'])).toEqual([
      2024, 2023, 2022,
    ]);
  });

  it('tolerates null/undefined entries', () => {
    expect(deriveYearOptions([null, undefined, '2024-01-01'])).toEqual([2024]);
  });

  it('returns empty for no data', () => {
    expect(deriveYearOptions([])).toEqual([]);
  });
});

describe('isInBagDuringYear', () => {
  it('matches boundary years on both ends', () => {
    // Acquired Dec 31 2023, retired Jan 1 2024 → in the bag during both years
    expect(isInBagDuringYear('2023-12-31', '2024-01-01', 2023)).toBe(true);
    expect(isInBagDuringYear('2023-12-31', '2024-01-01', 2024)).toBe(true);
  });

  it('excludes years before acquisition and after retirement', () => {
    expect(isInBagDuringYear('2021-05-01', '2023-08-01', 2020)).toBe(false);
    expect(isInBagDuringYear('2021-05-01', '2023-08-01', 2024)).toBe(false);
    expect(isInBagDuringYear('2021-05-01', '2023-08-01', 2022)).toBe(true);
  });

  it('treats null retirement as still in the bag', () => {
    expect(isInBagDuringYear('2021-05-01', null, 2030)).toBe(true);
  });

  it('treats null acquisition as owned since forever', () => {
    expect(isInBagDuringYear(null, '2022-01-01', 2000)).toBe(true);
    expect(isInBagDuringYear(null, '2022-01-01', 2023)).toBe(false);
    expect(isInBagDuringYear(null, null, 2024)).toBe(true);
  });
});

describe('deriveInBagYearOptions', () => {
  it('includes mid-span years between acquisition and retirement', () => {
    expect(
      deriveInBagYearOptions([{ acquiredOn: '2021-03-01', retiredOn: '2023-06-01' }], 2026)
    ).toEqual([2023, 2022, 2021]);
  });

  it('extends active gear through the current year', () => {
    expect(
      deriveInBagYearOptions([{ acquiredOn: '2024-01-15', retiredOn: null }], 2026)
    ).toEqual([2026, 2025, 2024]);
  });

  it('unions spans across items, deduped, newest first', () => {
    expect(
      deriveInBagYearOptions(
        [
          { acquiredOn: '2020-01-01', retiredOn: '2021-01-01' },
          { acquiredOn: '2021-06-01', retiredOn: '2022-06-01' },
        ],
        2026
      )
    ).toEqual([2022, 2021, 2020]);
  });

  it('skips items with no acquisition date and never goes backwards on bad spans', () => {
    expect(deriveInBagYearOptions([{ acquiredOn: null, retiredOn: '2022-01-01' }], 2026)).toEqual([]);
    // retired year before acquired year (bad data) → just the acquisition year
    expect(
      deriveInBagYearOptions([{ acquiredOn: '2023-01-01', retiredOn: '2020-01-01' }], 2026)
    ).toEqual([2023]);
  });
});

describe('matchesYearFilter', () => {
  it('empty filter matches everything', () => {
    expect(matchesYearFilter('2024-01-01', [])).toBe(true);
  });

  it('matches only listed years (OR semantics)', () => {
    expect(matchesYearFilter('2024-01-01', [2023, 2024])).toBe(true);
    expect(matchesYearFilter('2022-01-01', [2023, 2024])).toBe(false);
  });
});

describe('matchesSportFilter', () => {
  it('empty filter matches everything, including null sport', () => {
    expect(matchesSportFilter('golf', [])).toBe(true);
    expect(matchesSportFilter(null, [])).toBe(true);
  });

  it('matches listed sports and maps null to the general sentinel', () => {
    expect(matchesSportFilter('golf', ['golf'])).toBe(true);
    expect(matchesSportFilter('ice_hockey', ['golf'])).toBe(false);
    expect(matchesSportFilter(null, [GENERAL_SPORT_KEY])).toBe(true);
    expect(matchesSportFilter(null, ['golf'])).toBe(false);
  });
});

describe('formatMonthYear', () => {
  it('formats from string parts without timezone shift', () => {
    expect(formatMonthYear('2024-01-01')).toBe('Jan 2024');
    expect(formatMonthYear('2023-12-31')).toBe('Dec 2023');
  });

  it('supports year-only display', () => {
    expect(formatMonthYear('2024-06-15', { yearOnly: true })).toBe('2024');
  });

  it('falls back to the year when the month part is malformed', () => {
    expect(formatMonthYear('2024')).toBe('2024');
  });
});
