import { describe, expect, it } from 'vitest';
import { parseRecent, pushRecent, RECENT_TYPES_MAX } from '../record/recent-types';

describe('recent types', () => {
  it('moves the type to the front without duplicates and caps the list', () => {
    expect(pushRecent(['run', 'yoga', 'ride'], 'yoga')).toEqual(['yoga', 'run', 'ride']);
    let l = pushRecent([], 'run');
    for (const t of ['walk', 'hike', 'ride', 'swim', 'row', 'yoga', 'hiit'] as const) l = pushRecent(l, t);
    expect(l).toHaveLength(RECENT_TYPES_MAX);
    expect(l[0]).toBe('hiit');
    expect(l).not.toContain('run');
  });

  it('reads only known types from storage', () => {
    expect(parseRecent(['run', 'teleport', 'run', 3, 'yoga'])).toEqual(['run', 'yoga']);
    expect(parseRecent('run')).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
  });
});
