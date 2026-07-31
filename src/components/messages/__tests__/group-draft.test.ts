import { describe, it, expect } from 'vitest';
import {
  GROUP_MIN_MEMBERS,
  GROUP_NAME_MAX,
  buildGroupCreateBody,
  canCreateGroup,
  groupDraftError,
  toggleGroupMember,
} from '../group-draft';

const a = { id: 'aaa' };
const b = { id: 'bbb' };
const c = { id: 'ccc' };

describe('toggleGroupMember', () => {
  it('adds a member, preserving selection order', () => {
    expect(toggleGroupMember([a], b)).toEqual([a, b]);
  });

  it('removes an already-selected member', () => {
    expect(toggleGroupMember([a, b, c], b)).toEqual([a, c]);
  });

  it('is its own inverse', () => {
    expect(toggleGroupMember(toggleGroupMember([a], b), b)).toEqual([a]);
  });

  it('does not mutate the input', () => {
    const members = [a];
    toggleGroupMember(members, b);
    expect(members).toEqual([a]);
  });
});

describe('groupDraftError', () => {
  it('requires a name', () => {
    expect(groupDraftError('', [a, b])).toBe('Group name is required');
    expect(groupDraftError('   ', [a, b])).toBe('Group name is required');
  });

  it('THE POLICY: requires 2 members, not the 1 the server would accept', () => {
    // A 2-person "group" is a DM, and the group path has NO dedupe — one
    // member would mint a duplicate room on every attempt. If someone relaxes
    // this to match the server, this fails.
    expect(GROUP_MIN_MEMBERS).toBe(2);
    expect(groupDraftError('Trip', [a])).toBe('Add at least 2 members');
    expect(groupDraftError('Trip', [])).toBe('Add at least 2 members');
  });

  it('returns null for a submittable draft', () => {
    expect(groupDraftError('Trip', [a, b])).toBeNull();
    expect(groupDraftError('  Trip  ', [a, b, c])).toBeNull();
  });

  it('reports the name before the member count', () => {
    // Both wrong: the name is the first thing the user can fix.
    expect(groupDraftError('', [])).toBe('Group name is required');
  });
});

describe('canCreateGroup', () => {
  it('agrees with groupDraftError, always', () => {
    // The invariant that stops the button and the validator drifting apart.
    const cases = [
      { name: '', members: [] },
      { name: '', members: [a, b] },
      { name: 'Trip', members: [a] },
      { name: 'Trip', members: [a, b] },
      { name: '   ', members: [a, b, c] },
    ];
    for (const { name, members } of cases) {
      expect(canCreateGroup({ name, members, creating: false })).toBe(
        groupDraftError(name, members) === null
      );
    }
  });

  it('blocks while a create is in flight', () => {
    // Group creation has no server-side dedupe, so a double submit makes two
    // rooms. This is the guard.
    expect(canCreateGroup({ name: 'Trip', members: [a, b], creating: true })).toBe(false);
  });
});

describe('buildGroupCreateBody', () => {
  it('builds the POST /api/messages payload', () => {
    expect(buildGroupCreateBody('  Trip  ', [a, b])).toEqual({
      type: 'group',
      name: 'Trip',
      participantIds: ['aaa', 'bbb'],
    });
  });

  it('dedupes ids while keeping selection order', () => {
    expect(buildGroupCreateBody('Trip', [b, a, b]).participantIds).toEqual(['bbb', 'aaa']);
  });
});

describe('constants', () => {
  it('matches the server and board name cap', () => {
    expect(GROUP_NAME_MAX).toBe(100);
  });
});
