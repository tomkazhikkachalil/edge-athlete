import { describe, it, expect } from 'vitest';
import { POST_VISIBILITY, feedOffLine, isPrivateAccount, whoSeesPost } from '../audience';

describe('audience', () => {
  it('a post is always written public (the account decides)', () => {
    expect(POST_VISIBILITY).toBe('public');
  });

  it('says anyone on a public account and approved fans on a private one', () => {
    expect(whoSeesPost('public')).toMatch(/^Anyone can see it/);
    expect(whoSeesPost('private')).toMatch(/approved fans/);
  });

  it('treats an unknown account visibility as private — never over-promise', () => {
    expect(isPrivateAccount(undefined)).toBe(true);
    expect(isPrivateAccount(null)).toBe(true);
    expect(whoSeesPost(undefined)).toMatch(/approved fans/);
  });

  it('the OFF line names where the item stands — never "only you" (269: off-feed is still on the profile)', () => {
    expect(feedOffLine()).toBe('Not on the feed — stays on your profile');
    expect(feedOffLine('in Training')).toBe('Not on the feed — stays on your profile, in Training');
    expect(feedOffLine()).not.toMatch(/only you/i);
  });
});
