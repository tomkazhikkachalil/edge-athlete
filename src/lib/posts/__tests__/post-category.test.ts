import { describe, it, expect } from 'vitest';
import { normalizePostIdentity, isPostCategory } from '../post-category';

describe('isPostCategory', () => {
  it('accepts training, rejects everything else', () => {
    expect(isPostCategory('training')).toBe(true);
    expect(isPostCategory('golf')).toBe(false);
    expect(isPostCategory('')).toBe(false);
    expect(isPostCategory(null)).toBe(false);
    expect(isPostCategory(42)).toBe(false);
  });
});

describe('normalizePostIdentity', () => {
  it('legacy alias: postType training becomes general + training category', () => {
    expect(normalizePostIdentity('training', undefined)).toEqual({
      postType: 'general',
      postCategory: 'training',
    });
    // Alias wins even if a category was also sent — the pre-077 client
    // never sent one, so this shape is unambiguous.
    expect(normalizePostIdentity('training', 'training')).toEqual({
      postType: 'general',
      postCategory: 'training',
    });
  });

  it('absent/empty category passes through as null', () => {
    expect(normalizePostIdentity('general', undefined)).toEqual({ postType: 'general', postCategory: null });
    expect(normalizePostIdentity('golf', null)).toEqual({ postType: 'golf', postCategory: null });
    expect(normalizePostIdentity('general', '')).toEqual({ postType: 'general', postCategory: null });
  });

  it('valid category passes through', () => {
    expect(normalizePostIdentity('general', 'training')).toEqual({
      postType: 'general',
      postCategory: 'training',
    });
  });

  it('invalid category errors', () => {
    expect(normalizePostIdentity('general', 'nonsense')).toEqual({ error: 'Invalid post category' });
    expect(normalizePostIdentity('general', 7)).toEqual({ error: 'Invalid post category' });
  });

  it('sport post types pass through untouched', () => {
    expect(normalizePostIdentity('golf', undefined)).toEqual({ postType: 'golf', postCategory: null });
    expect(normalizePostIdentity('ice_hockey', undefined)).toEqual({ postType: 'ice_hockey', postCategory: null });
  });
});
