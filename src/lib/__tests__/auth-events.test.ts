import { describe, it, expect } from 'vitest';
import { planAuthEvent } from '../auth-events';

const A = 'aaaaaaaa-0000-4000-8000-000000000000';
const B = 'bbbbbbbb-0000-4000-8000-000000000000';

describe('planAuthEvent — the same person stays the same', () => {
  it('a token refresh or a refocus SIGNED_IN for the same person changes nothing', () => {
    for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN', 'INITIAL_SESSION']) {
      expect(planAuthEvent({ event, currentUserId: A, nextUserId: A, profileRequestedFor: A })).toEqual({
        clear: false,
        keepUser: true,
        fetchProfile: false,
      });
    }
  });
  it('INITIAL_SESSION before the boot read started still reads the profile, once', () => {
    expect(planAuthEvent({ event: 'INITIAL_SESSION', currentUserId: null, nextUserId: A, profileRequestedFor: null })).toEqual({
      clear: false,
      keepUser: false,
      fetchProfile: true,
    });
  });
  it('a sign-in as someone, or as someone else, is a new person', () => {
    expect(planAuthEvent({ event: 'SIGNED_IN', currentUserId: null, nextUserId: A, profileRequestedFor: null })).toMatchObject({
      keepUser: false,
      fetchProfile: true,
    });
    expect(planAuthEvent({ event: 'SIGNED_IN', currentUserId: A, nextUserId: B, profileRequestedFor: A })).toMatchObject({
      keepUser: false,
      fetchProfile: true,
    });
  });
  it('an account update refreshes everything; a sign-out clears', () => {
    expect(planAuthEvent({ event: 'USER_UPDATED', currentUserId: A, nextUserId: A, profileRequestedFor: A })).toEqual({
      clear: false,
      keepUser: false,
      fetchProfile: true,
    });
    expect(planAuthEvent({ event: 'SIGNED_OUT', currentUserId: A, nextUserId: null, profileRequestedFor: A }).clear).toBe(true);
    expect(planAuthEvent({ event: 'TOKEN_REFRESHED', currentUserId: A, nextUserId: null, profileRequestedFor: A }).clear).toBe(true);
  });
});
