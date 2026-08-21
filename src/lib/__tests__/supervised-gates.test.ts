import { describe, it, expect } from 'vitest';
import { resolveCommentStatus, outboundAllowed, canInviteSupervised } from '../supervised-gates';

describe('resolveCommentStatus', () => {
  it('only supervised authors are ever gated', () => {
    expect(resolveCommentStatus(null, 'held')).toBe('published');
    expect(resolveCommentStatus('owner', 'held')).toBe('published');
    expect(resolveCommentStatus('guardian', 'held')).toBe('published');
    expect(resolveCommentStatus('viewer', 'held')).toBe('published');
  });

  it('supervised + held → pending', () => {
    expect(resolveCommentStatus('supervised', 'held')).toBe('pending_approval');
  });

  it('supervised + instant → published', () => {
    expect(resolveCommentStatus('supervised', 'instant')).toBe('published');
  });

  it('a missing toggle defaults to held (safety default, matches the DB default)', () => {
    expect(resolveCommentStatus('supervised', null)).toBe('pending_approval');
    expect(resolveCommentStatus('supervised', undefined)).toBe('pending_approval');
  });
});

describe('outboundAllowed', () => {
  it('everyone: always', () => {
    expect(outboundAllowed('everyone', false, false)).toBe(true);
  });

  it('fans_only: the counterparty must follow the child', () => {
    expect(outboundAllowed('fans_only', false, true)).toBe(true);
    expect(outboundAllowed('fans_only', true, false)).toBe(false);
    expect(outboundAllowed('fans_only', false, false)).toBe(false);
  });

  it('mutual_fans: both directions required', () => {
    expect(outboundAllowed('mutual_fans', true, true)).toBe(true);
    expect(outboundAllowed('mutual_fans', true, false)).toBe(false);
    expect(outboundAllowed('mutual_fans', false, true)).toBe(false);
  });

  it('nobody: never', () => {
    expect(outboundAllowed('nobody', true, true)).toBe(false);
  });
});

// Args: (permission, inviterIsGuardian, inviterFollowsChild, childFollowsInviter)
describe('canInviteSupervised', () => {
  it('the child\'s own guardian always passes, even on nobody', () => {
    expect(canInviteSupervised('nobody', true, false, false)).toBe(true);
    expect(canInviteSupervised('mutual_fans', true, false, false)).toBe(true);
  });

  it('everyone: any inviter', () => {
    expect(canInviteSupervised('everyone', false, false, false)).toBe(true);
  });

  it('fans_only: the inviter must be an accepted fan of the child', () => {
    expect(canInviteSupervised('fans_only', false, true, false)).toBe(true);
    expect(canInviteSupervised('fans_only', false, false, true)).toBe(false);
    expect(canInviteSupervised('fans_only', false, false, false)).toBe(false);
  });

  it('mutual_fans: both directions required', () => {
    expect(canInviteSupervised('mutual_fans', false, true, true)).toBe(true);
    expect(canInviteSupervised('mutual_fans', false, true, false)).toBe(false);
    expect(canInviteSupervised('mutual_fans', false, false, true)).toBe(false);
  });

  it('nobody: no non-guardian inviter, ever', () => {
    expect(canInviteSupervised('nobody', false, true, true)).toBe(false);
  });
});
