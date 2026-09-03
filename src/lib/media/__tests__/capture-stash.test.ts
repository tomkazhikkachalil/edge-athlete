import { describe, it, expect } from 'vitest';
import { CAPTURE_STASH_TTL_MS, isFreshStash } from '../capture-stash';

// IndexedDB has no node implementation; the storage functions are verified
// in the browser (e2e/capture-stash.spec.ts). This pins the freshness rule
// they all share.
describe('isFreshStash', () => {
  const now = 1_800_000_000_000;

  it('accepts a stash saved within the TTL', () => {
    expect(isFreshStash(now, now)).toBe(true);
    expect(isFreshStash(now - CAPTURE_STASH_TTL_MS, now)).toBe(true);
  });

  it('rejects a stash older than the TTL', () => {
    expect(isFreshStash(now - CAPTURE_STASH_TTL_MS - 1, now)).toBe(false);
  });

  it('rejects the future and anything that is not a finite number', () => {
    expect(isFreshStash(now + 1, now)).toBe(false);
    expect(isFreshStash('yesterday', now)).toBe(false);
    expect(isFreshStash(Number.NaN, now)).toBe(false);
    expect(isFreshStash(undefined, now)).toBe(false);
  });
});
