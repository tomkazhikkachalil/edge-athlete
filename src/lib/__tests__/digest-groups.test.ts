import { describe, it, expect } from 'vitest';
import { buildDigestGroups, itemProfileId, type DigestItem } from '../digest-groups';

const item = (title: string, metadata?: unknown): DigestItem => ({
  title,
  created_at: '2026-08-28T12:00:00Z',
  metadata,
});

describe('itemProfileId', () => {
  it('string-guards jsonb shapes', () => {
    expect(itemProfileId(item('x', { profile_id: 'abc' }))).toBe('abc');
    expect(itemProfileId(item('x', { profile_id: 42 }))).toBeNull();
    expect(itemProfileId(item('x', { profile_id: '' }))).toBeNull();
    expect(itemProfileId(item('x', null))).toBeNull();
    expect(itemProfileId(item('x', ['profile_id']))).toBeNull();
    expect(itemProfileId(item('x'))).toBeNull();
  });
});

describe('buildDigestGroups', () => {
  it('groups on metadata.profile_id, first-seen order, general bucket LAST', () => {
    const groups = buildDigestGroups([
      item('own like'),
      item('a1', { profile_id: 'child-a' }),
      item('b1', { profile_id: 'child-b' }),
      item('a2', { profile_id: 'child-a' }),
    ]);
    expect(groups.map(g => g.profileId)).toEqual(['child-a', 'child-b', null]);
    expect(groups[0].items.map(i => i.title)).toEqual(['a1', 'a2']);
    expect(groups[2].items.map(i => i.title)).toEqual(['own like']);
  });

  it('no metadata anywhere → one general group (adults share the template)', () => {
    const groups = buildDigestGroups([item('a'), item('b')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].profileId).toBeNull();
    expect(groups[0].items).toHaveLength(2);
  });

  it('empty input → empty output (no empty general bucket)', () => {
    expect(buildDigestGroups([])).toEqual([]);
  });
});
