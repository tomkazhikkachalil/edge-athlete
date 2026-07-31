import { describe, it, expect } from 'vitest';
import { isOptimizableImageSrc } from '../image-src';

describe('isOptimizableImageSrc', () => {
  it('accepts Supabase Storage object URLs', () => {
    expect(
      isOptimizableImageSrc(
        'https://htwhmdoiszhhmwuflgci.supabase.co/storage/v1/object/public/uploads/cover.jpg'
      )
    ).toBe(true);
    // Signed URLs carry a query string — still the same object path.
    expect(
      isOptimizableImageSrc(
        'https://abc.supabase.in/storage/v1/object/sign/avatars/y.png?token=eyJhbGc'
      )
    ).toBe(true);
  });

  it('rejects the Supabase render/transform endpoint', () => {
    // next.config.ts allowlists pathname '/storage/v1/object/**' only.
    expect(
      isOptimizableImageSrc(
        'https://abc.supabase.co/storage/v1/render/image/public/uploads/x.jpg'
      )
    ).toBe(false);
  });

  it('rejects Google OAuth avatars', () => {
    // deriveAvatarUrl (lib/oauth-profile.ts) stores Google's `picture` URL
    // verbatim via api/auth/complete-profile. lh3.googleusercontent.com is NOT
    // in remotePatterns, so an unguarded <Image> renders broken for every
    // Google-signup user. This case is the whole reason the helper exists.
    expect(
      isOptimizableImageSrc('https://lh3.googleusercontent.com/a/ACg8ocKf9Xq=s96-c')
    ).toBe(false);
  });

  it('rejects Giphy despite it being allowlisted in next.config.ts', () => {
    // Animated sources stream through the optimizer unchanged: zero bytes
    // saved, one billable transformation spent.
    expect(isOptimizableImageSrc('https://media0.giphy.com/media/xyz/200.gif')).toBe(false);
  });

  it('rejects client-only object URLs the server-side optimizer cannot fetch', () => {
    expect(isOptimizableImageSrc('blob:http://localhost:3000/8f9a-uuid')).toBe(false);
    expect(isOptimizableImageSrc('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(false);
  });

  it('rejects plaintext http even on an allowlisted host', () => {
    expect(
      isOptimizableImageSrc('http://abc.supabase.co/storage/v1/object/public/x.jpg')
    ).toBe(false);
  });

  it('rejects lookalike hosts', () => {
    expect(
      isOptimizableImageSrc('https://supabase.co.evil.com/storage/v1/object/public/x.jpg')
    ).toBe(false);
  });

  it('accepts same-origin paths', () => {
    expect(isOptimizableImageSrc('/logo.png')).toBe(true);
    expect(isOptimizableImageSrc('/_next/static/media/hero.png')).toBe(true);
  });

  it('returns false without throwing on empty or unparseable input', () => {
    expect(isOptimizableImageSrc('')).toBe(false);
    expect(isOptimizableImageSrc('not a url')).toBe(false);
    expect(isOptimizableImageSrc(null)).toBe(false);
    expect(isOptimizableImageSrc(undefined)).toBe(false);
  });
});
