import { describe, it, expect } from 'vitest';
import { DEFAULT_CHOICE, POST_VISIBILITY, isPrivateAccount, onlyMeLine, whoSeesPost } from '../audience';

describe('audience', () => {
  it('defaults to posting, always written public (the account decides)', () => {
    expect(DEFAULT_CHOICE).toBe('post');
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

  it('names where an Only me item is kept', () => {
    expect(onlyMeLine()).toBe('Not on the feed — only you can see it');
    expect(onlyMeLine('in your Vitals')).toBe('Not on the feed — only you can see it, in your Vitals');
  });
});
