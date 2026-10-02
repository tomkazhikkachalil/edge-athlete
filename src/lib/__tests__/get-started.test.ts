import { describe, it, expect } from 'vitest';
import { DISMISSED_META_KEY, LEGACY_DISMISS_KEY, dismissKeyFor, isDismissedInMetadata } from '../get-started';

describe('the Get Started dismissal', () => {
  it('keys the browser copy by account, beside the legacy key', () => {
    expect(dismissKeyFor('u-1')).toBe(`${LEGACY_DISMISS_KEY}:u-1`);
    expect(dismissKeyFor('u-1')).not.toBe(dismissKeyFor('u-2'));
  });

  it('reads the account stamp, and nothing else, as dismissed', () => {
    expect(isDismissedInMetadata({ [DISMISSED_META_KEY]: '2026-10-02T01:00:00.000Z' })).toBe(true);
    expect(isDismissedInMetadata({ [DISMISSED_META_KEY]: null })).toBe(false);
    expect(isDismissedInMetadata({ [DISMISSED_META_KEY]: '' })).toBe(false);
    expect(isDismissedInMetadata({ [DISMISSED_META_KEY]: true })).toBe(false);
    expect(isDismissedInMetadata({ full_name: 'Edge Alpha' })).toBe(false);
    expect(isDismissedInMetadata(null)).toBe(false);
    expect(isDismissedInMetadata(undefined)).toBe(false);
  });
});
