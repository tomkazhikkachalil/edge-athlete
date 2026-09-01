import { describe, expect, it } from 'vitest';
import {
  clampScheduleQuery,
  SCHEDULE_LIMIT_DEFAULT,
  SCHEDULE_LIMIT_MAX,
  SCHEDULE_RANGE_MAX_DAYS,
} from '../validate';

describe('clampScheduleQuery', () => {
  it('defaults with no input', () => {
    expect(clampScheduleQuery()).toEqual({ limit: SCHEDULE_LIMIT_DEFAULT });
    expect(clampScheduleQuery({})).toEqual({ limit: SCHEDULE_LIMIT_DEFAULT });
  });

  it('accepts in-range values (string or number)', () => {
    expect(clampScheduleQuery({ limit: 25, rangeDays: '30' })).toEqual({
      limit: 25,
      rangeDays: 30,
    });
  });

  it('clamps to the floor', () => {
    expect(clampScheduleQuery({ limit: 0, rangeDays: -5 })).toEqual({
      limit: 1,
      rangeDays: 1,
    });
  });

  it('clamps to the ceiling', () => {
    expect(clampScheduleQuery({ limit: 999, rangeDays: 9999 })).toEqual({
      limit: SCHEDULE_LIMIT_MAX,
      rangeDays: SCHEDULE_RANGE_MAX_DAYS,
    });
  });

  it('floors non-integers', () => {
    expect(clampScheduleQuery({ limit: 7.9, rangeDays: '14.5' })).toEqual({
      limit: 7,
      rangeDays: 14,
    });
  });

  it('ignores garbage (defaults, no rangeDays)', () => {
    expect(clampScheduleQuery({ limit: 'abc', rangeDays: '' })).toEqual({
      limit: SCHEDULE_LIMIT_DEFAULT,
    });
    expect(clampScheduleQuery({ limit: NaN, rangeDays: Infinity })).toEqual({
      limit: SCHEDULE_LIMIT_DEFAULT,
    });
  });
});
