import { describe, expect, it } from 'vitest';
import {
  clampScheduleQuery,
  SCHEDULE_LIMIT_DEFAULT,
  SCHEDULE_LIMIT_MAX,
  SCHEDULE_RANGE_MAX_DAYS,
  SitePatchSchema,
  TOGGLEABLE_MODULE_KEYS,
} from '../validate';

describe('SitePatchSchema', () => {
  it('accepts publish/unpublish (the R1 shape, unchanged)', () => {
    expect(SitePatchSchema.safeParse({ action: 'publish' }).success).toBe(true);
    expect(SitePatchSchema.safeParse({ action: 'unpublish' }).success).toBe(true);
  });

  it('accepts set_module for every toggleable key', () => {
    for (const key of TOGGLEABLE_MODULE_KEYS) {
      expect(
        SitePatchSchema.safeParse({ action: 'set_module', moduleKey: key, enabled: false })
          .success
      ).toBe(true);
    }
  });

  it('rejects toggling hero — excluded at the schema level', () => {
    expect(
      SitePatchSchema.safeParse({ action: 'set_module', moduleKey: 'hero', enabled: false })
        .success
    ).toBe(false);
  });

  it('rejects set_module without enabled, and unknown actions/keys', () => {
    expect(
      SitePatchSchema.safeParse({ action: 'set_module', moduleKey: 'standings' }).success
    ).toBe(false);
    expect(
      SitePatchSchema.safeParse({ action: 'set_module', moduleKey: 'nope', enabled: true })
        .success
    ).toBe(false);
    expect(SitePatchSchema.safeParse({ action: 'delete' }).success).toBe(false);
  });
});

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
