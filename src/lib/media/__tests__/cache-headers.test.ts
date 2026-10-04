import { describe, it, expect } from 'vitest';
import { mediaCacheHeaders, PRIVATE_MAX_AGE_CAP, PRIVATE_NO_EXP_MAX_AGE } from '../cache-headers';
import { isPublicPostMedia } from '../visibility';

describe('mediaCacheHeaders', () => {
  it('public media: one copy for everyone — public, CDN a day, browser an hour, NO Vary', () => {
    const h = mediaCacheHeaders({ isPublic: true });
    expect(h['cache-control']).toBe('public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    expect(Object.keys(h)).toEqual(['cache-control']);
  });

  it('private media caches on the device for the token\'s remaining life, capped at a day, never shared', () => {
    const now = 1_800_000_000;
    expect(mediaCacheHeaders({ isPublic: false, tokenExp: now + 5000, now })['cache-control']).toBe('private, max-age=5000, no-transform');
    expect(mediaCacheHeaders({ isPublic: false, tokenExp: now + 200_000, now })['cache-control']).toBe(`private, max-age=${PRIVATE_MAX_AGE_CAP}, no-transform`);
    expect(mediaCacheHeaders({ isPublic: false, tokenExp: now - 1, now })['cache-control']).toBe('private, max-age=0, no-transform');
  });

  it('a private URL without an expiry (an older mint) still caches briefly on the device', () => {
    expect(mediaCacheHeaders({ isPublic: false })['cache-control']).toBe(`private, max-age=${PRIVATE_NO_EXP_MAX_AGE}, no-transform`);
  });

  it('never says public or s-maxage for private media', () => {
    for (const exp of [undefined, 1, 10 ** 10]) {
      const v = mediaCacheHeaders({ isPublic: false, tokenExp: exp })['cache-control'];
      expect(v).not.toMatch(/public|s-maxage/);
    }
  });
});

describe('isPublicPostMedia — the one predicate', () => {
  it('needs BOTH the post and its owner public; a missing value is private', () => {
    expect(isPublicPostMedia({ postVisibility: 'public', ownerVisibility: 'public' })).toBe(true);
    expect(isPublicPostMedia({ postVisibility: 'private', ownerVisibility: 'public' })).toBe(false);
    expect(isPublicPostMedia({ postVisibility: 'public', ownerVisibility: 'private' })).toBe(false);
    expect(isPublicPostMedia({ postVisibility: null, ownerVisibility: 'public' })).toBe(false);
    expect(isPublicPostMedia({ postVisibility: 'public', ownerVisibility: undefined })).toBe(false);
  });
});
