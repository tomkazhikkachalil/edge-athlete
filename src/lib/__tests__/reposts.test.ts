import { describe, it, expect } from 'vitest';
import { resolveRepostTarget, canViewSharedPost, validateRepostBody } from '../reposts';

describe('resolveRepostTarget', () => {
  it('a plain post targets itself', () => {
    expect(resolveRepostTarget({ id: 'a', shared_post_id: null })).toBe('a');
    expect(resolveRepostTarget({ id: 'a' })).toBe('a');
  });

  it('a repost collapses to its root original', () => {
    expect(resolveRepostTarget({ id: 'repost-1', shared_post_id: 'root' })).toBe('root');
  });
});

describe('canViewSharedPost', () => {
  const base = { isOwner: false, isFollower: false };

  it('owner always sees their own post', () => {
    expect(canViewSharedPost({
      postVisibility: 'private', ownerVisibility: 'private', isOwner: true, isFollower: false,
    })).toBe(true);
  });

  it('public post by public profile is open to everyone (incl. anonymous)', () => {
    expect(canViewSharedPost({ ...base, postVisibility: 'public', ownerVisibility: 'public' })).toBe(true);
  });

  it('null/unknown visibilities are treated as open (messages parity)', () => {
    expect(canViewSharedPost({ ...base, postVisibility: null, ownerVisibility: undefined })).toBe(true);
  });

  it('private post requires following the owner', () => {
    expect(canViewSharedPost({ ...base, postVisibility: 'private', ownerVisibility: 'public' })).toBe(false);
    expect(canViewSharedPost({
      ...base, postVisibility: 'private', ownerVisibility: 'public', isFollower: true,
    })).toBe(true);
  });

  it('private profile requires following the owner', () => {
    expect(canViewSharedPost({ ...base, postVisibility: 'public', ownerVisibility: 'private' })).toBe(false);
    expect(canViewSharedPost({
      ...base, postVisibility: 'public', ownerVisibility: 'private', isFollower: true,
    })).toBe(true);
  });

  it('private post by private profile: follower passes, stranger fails', () => {
    expect(canViewSharedPost({
      ...base, postVisibility: 'private', ownerVisibility: 'private', isFollower: true,
    })).toBe(true);
    expect(canViewSharedPost({
      ...base, postVisibility: 'private', ownerVisibility: 'private',
    })).toBe(false);
  });
});

describe('validateRepostBody', () => {
  it('caption-only repost is valid', () => {
    expect(validateRepostBody({})).toBeNull();
    expect(validateRepostBody({ media: [], golfData: null, stats_data: null })).toBeNull();
  });

  it('empty stats object is valid (matches the statement predicate)', () => {
    expect(validateRepostBody({ stats_data: {} })).toBeNull();
  });

  it('media is rejected', () => {
    expect(validateRepostBody({ media: [{ url: 'x' }] })).toMatch(/media/);
  });

  it('golf data is rejected', () => {
    expect(validateRepostBody({ golfData: { course: 'x' } })).toMatch(/golf/);
  });

  it('non-empty stats are rejected', () => {
    expect(validateRepostBody({ stats_data: { pts: 1 } })).toMatch(/stats/);
  });
});
