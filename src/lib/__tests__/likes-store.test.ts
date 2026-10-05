import { beforeEach, describe, expect, it } from 'vitest';
import { _resetLikesStore, knownLike, likedFor, rememberLike, rememberLikes } from '../likes/store';

describe('likes store — one liked truth per tab', () => {
  beforeEach(() => _resetLikesStore());

  it('knows nothing until told, then the last writer wins', () => {
    expect(knownLike('p1')).toBeUndefined();
    rememberLike('p1', true);
    expect(knownLike('p1')).toBe(true);
    rememberLike('p1', false);
    expect(knownLike('p1')).toBe(false);
  });

  it('a read that knew the viewer records every row', () => {
    rememberLikes([{ id: 'a', liked: true }, { id: 'b', liked: false }]);
    expect(knownLike('a')).toBe(true);
    expect(knownLike('b')).toBe(false);
  });

  it('likedFor: the tab’s knowledge first, the row second', () => {
    // An anonymous refetch (likes: []) cannot empty a heart the tab filled.
    rememberLike('p1', true);
    expect(likedFor('p1', [], 'viewer')).toBe(true);
    // Unknown post: the row decides, for THIS viewer only.
    expect(likedFor('p2', [{ profile_id: 'viewer' }], 'viewer')).toBe(true);
    expect(likedFor('p2', [{ profile_id: 'someone' }], 'viewer')).toBe(false);
    expect(likedFor('p2', [{ profile_id: 'viewer' }], null)).toBe(false);
    expect(likedFor('p2', undefined, 'viewer')).toBe(false);
  });
});
