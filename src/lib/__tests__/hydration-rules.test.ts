import { describe, it, expect } from 'vitest';
import { FEED_DEVICE_MAX_POSTS, HYDRATION_KINDS, acceptEnvelope, hydrationKey, isHydrationKey, makeEnvelope, trimFeedForDevice } from '../net/hydration-rules';

/** The device store's rules (performance program, Phase 2b — Nov 2026). */
describe('the device store — keys', () => {
  it('keys carry the account first, so one account is one prefix', () => {
    expect(hydrationKey('u1', 'profile')).toBe('ea:hyd:v1:u1:profile');
    expect(isHydrationKey('ea:hyd:v1:u1:feed')).toBe(true);
    expect(isHydrationKey('ea:theme:v1')).toBe(false);
  });
  it('only three kinds may be stored, each with a lifetime', () => {
    expect(Object.keys(HYDRATION_KINDS).sort()).toEqual(['feed', 'profile', 'pulse']);
    expect(HYDRATION_KINDS.profile).toBe(7 * 24 * 60 * 60_000);
    expect(HYDRATION_KINDS.feed).toBe(24 * 60 * 60_000);
  });
});

describe('the device store — accepting a copy', () => {
  const now = 1_000_000_000_000;
  it('accepts this account\'s fresh copy and nothing else', () => {
    const e = makeEnvelope('u1', { name: 'A' }, now - 1000);
    expect(acceptEnvelope(e, 'u1', 'profile', now)).toEqual({ name: 'A' });
    expect(acceptEnvelope(e, 'u2', 'profile', now)).toBeNull(); // another account
    expect(acceptEnvelope({ ...e, v: 0 }, 'u1', 'profile', now)).toBeNull(); // another shape
    expect(acceptEnvelope(null, 'u1', 'profile', now)).toBeNull();
    expect(acceptEnvelope('garbage', 'u1', 'profile', now)).toBeNull();
  });
  it('a copy past its kind\'s lifetime is ignored; a clock set into the future too', () => {
    const old = makeEnvelope('u1', [1], now - HYDRATION_KINDS.feed - 1);
    expect(acceptEnvelope(old, 'u1', 'feed', now)).toBeNull();
    expect(acceptEnvelope(makeEnvelope('u1', [1], now - HYDRATION_KINDS.feed), 'u1', 'feed', now)).toEqual([1]);
    expect(acceptEnvelope(makeEnvelope('u1', [1], now + 120_000), 'u1', 'feed', now)).toBeNull();
  });
  it('the feed keeps its first page only', () => {
    expect(FEED_DEVICE_MAX_POSTS).toBe(20);
    expect(trimFeedForDevice(Array.from({ length: 30 }, (_, i) => i))).toHaveLength(20);
  });
});
