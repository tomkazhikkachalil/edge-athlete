import { describe, it, expect } from 'vitest';
import { DISMISSED_META_KEY, LEGACY_DISMISS_KEY, NEW_ACCOUNT_WINDOW_DAYS, dismissKeyFor, isDismissedInMetadata, shouldReserveGetStarted } from '../get-started';

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

// The card holds its place from the first paint (Oct 22 2026, Tom: "reserve
// its space"): the client decides from what it already holds.
describe('reserving the card before its API answers', () => {
  const NOW = Date.parse('2026-10-22T12:00:00Z');
  const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
  const fresh = { createdAt: daysAgo(1), userType: 'athlete', browserDismissed: false };

  it('a young athlete account this device never closed reserves', () => {
    expect(shouldReserveGetStarted(fresh, NOW)).toBe(true);
    expect(shouldReserveGetStarted({ ...fresh, createdAt: daysAgo(NEW_ACCOUNT_WINDOW_DAYS - 0.01) }, NOW)).toBe(true);
    expect(shouldReserveGetStarted({ ...fresh, userType: 'fan' }, NOW)).toBe(true);
  });
  it('an account at or past the window does not', () => {
    expect(shouldReserveGetStarted({ ...fresh, createdAt: daysAgo(NEW_ACCOUNT_WINDOW_DAYS) }, NOW)).toBe(false);
    expect(shouldReserveGetStarted({ ...fresh, createdAt: daysAgo(40) }, NOW)).toBe(false);
  });
  it('an organizer, a device that closed it, or no profile yet does not', () => {
    expect(shouldReserveGetStarted({ ...fresh, userType: 'organizer' }, NOW)).toBe(false);
    expect(shouldReserveGetStarted({ ...fresh, browserDismissed: true }, NOW)).toBe(false);
    expect(shouldReserveGetStarted({ ...fresh, createdAt: null }, NOW)).toBe(false);
    expect(shouldReserveGetStarted({ ...fresh, createdAt: 'not a date' }, NOW)).toBe(false);
  });
});
