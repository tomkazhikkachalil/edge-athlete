import { describe, expect, it } from 'vitest';
import { isValidTimeZone, TIME_ZONE_MAX } from '../time-zones';

describe('isValidTimeZone — the one validator', () => {
  it('admits IANA names, refuses garbage, the empty string and an over-long value', () => {
    expect(isValidTimeZone('Pacific/Honolulu')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('A'.repeat(TIME_ZONE_MAX + 1))).toBe(false);
  });
});
