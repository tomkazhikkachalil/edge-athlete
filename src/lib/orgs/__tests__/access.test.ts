import { describe, expect, it } from 'vitest';
import { accessFromRow, canSeeMembersContent, isPrivate, OPEN_ACCESS } from '../access';

describe('accessFromRow', () => {
  it('reads visibility + join policy; unknown values and absent columns fall to public / open', () => {
    expect(accessFromRow({ id: 'c', visibility: 'private', join_policy: 'approval' })).toEqual({
      known: true,
      visibility: 'private',
      joinPolicy: 'approval',
    });
    expect(accessFromRow({ id: 'c', visibility: 'public', join_policy: 'open' })).toEqual({ known: true, visibility: 'public', joinPolicy: 'open' });
    expect(accessFromRow({ id: 'c', visibility: 'weird', join_policy: 'weird' })).toEqual({ known: true, visibility: 'public', joinPolicy: 'open' });
    expect(accessFromRow({ id: 'c', name: 'pre-176' })).toEqual(OPEN_ACCESS);
    expect(accessFromRow(null)).toEqual(OPEN_ACCESS);
  });
});

describe('canSeeMembersContent / isPrivate', () => {
  it('public shows everyone; private shows members only', () => {
    expect(canSeeMembersContent({ visibility: 'public', isMember: false })).toBe(true);
    expect(canSeeMembersContent({ visibility: 'private', isMember: false })).toBe(false);
    expect(canSeeMembersContent({ visibility: 'private', isMember: true })).toBe(true);
    expect(isPrivate({ visibility: 'private' })).toBe(true);
    expect(isPrivate(OPEN_ACCESS)).toBe(false);
  });
});
