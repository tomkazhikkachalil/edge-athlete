import { describe, it, expect } from 'vitest';
import { canReadPost, type PostReadFacts } from '../read-gate';

const stranger: PostReadFacts = {
  isOwner: false, hasAccess: false, isFan: false,
  postVisibility: 'public', profileVisibility: 'public', status: 'published',
};

describe('canReadPost', () => {
  it('lets anyone read a published public post on a public account', () => {
    expect(canReadPost(stranger)).toBe(true);
  });

  it('keeps a private post to the owner, the guardian and approved fans', () => {
    const priv = { ...stranger, postVisibility: 'private' };
    expect(canReadPost(priv)).toBe(false);
    expect(canReadPost({ ...priv, isFan: true })).toBe(true);
    expect(canReadPost({ ...priv, isOwner: true })).toBe(true);
    expect(canReadPost({ ...priv, hasAccess: true })).toBe(true);
  });

  it('keeps a public post on a PRIVATE account to fans', () => {
    const onPrivate = { ...stranger, profileVisibility: 'private' };
    expect(canReadPost(onPrivate)).toBe(false);
    expect(canReadPost({ ...onPrivate, isFan: true })).toBe(true);
  });

  it('shows a draft or a hidden post only to its owner or guardian', () => {
    for (const status of ['draft', 'hidden', 'profile_hidden']) {
      expect(canReadPost({ ...stranger, status })).toBe(false);
      expect(canReadPost({ ...stranger, status, isFan: true })).toBe(false);
      expect(canReadPost({ ...stranger, status, isOwner: true })).toBe(true);
      expect(canReadPost({ ...stranger, status, hasAccess: true })).toBe(true);
    }
  });

  it('reads a row without a status as published', () => {
    expect(canReadPost({ ...stranger, status: null })).toBe(true);
  });
});
