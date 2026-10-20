import { describe, it, expect } from 'vitest';
import { FEED_MEMORY_KEY, readFeedDefault, rememberFeedChoice } from '../feed-memory';

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), dump: () => Object.fromEntries(m) };
}

describe('feed-memory — "Post to feed" remembered per kind on the device (269)', () => {
  it('defaults ON for every kind when nothing is stored, and when storage is absent', () => {
    const s = fakeStorage();
    expect(readFeedDefault('sport', s)).toBe(true);
    expect(readFeedDefault('activity', s)).toBe(true);
    expect(readFeedDefault('workout', s)).toBe(true);
    expect(readFeedDefault('activity', null)).toBe(true);
  });

  it('remembers one kind without touching the others', () => {
    const s = fakeStorage();
    rememberFeedChoice('activity', false, s);
    expect(readFeedDefault('activity', s)).toBe(false);
    expect(readFeedDefault('sport', s)).toBe(true);
    expect(readFeedDefault('workout', s)).toBe(true);
    rememberFeedChoice('workout', false, s);
    rememberFeedChoice('activity', true, s);
    expect(JSON.parse(s.dump()[FEED_MEMORY_KEY])).toEqual({ activity: true, workout: false });
  });

  it('ignores a corrupt or foreign value — fail-open to ON', () => {
    expect(readFeedDefault('sport', fakeStorage({ [FEED_MEMORY_KEY]: 'not json' }))).toBe(true);
    expect(readFeedDefault('sport', fakeStorage({ [FEED_MEMORY_KEY]: '{"sport":"no"}' }))).toBe(true);
    expect(readFeedDefault('sport', fakeStorage({ [FEED_MEMORY_KEY]: '[]' }))).toBe(true);
  });

  it('a throwing storage never throws out', () => {
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readFeedDefault('sport', bad)).toBe(true);
    expect(() => rememberFeedChoice('sport', false, bad)).not.toThrow();
  });
});
