import { describe, it, expect } from 'vitest';
import { storageRefFromUrl } from '../account-deletion';

const BASE = 'https://abc123.supabase.co/storage/v1/object/public';

describe('storageRefFromUrl', () => {
  it('parses uploads-bucket URLs', () => {
    expect(storageRefFromUrl(`${BASE}/uploads/posts/uid-1/123-abc.png`)).toEqual({
      bucket: 'uploads',
      path: 'posts/uid-1/123-abc.png',
    });
  });

  it('parses avatars and legacy post-media buckets', () => {
    expect(storageRefFromUrl(`${BASE}/avatars/avatars/avatar-uid-1.jpg`)).toEqual({
      bucket: 'avatars',
      path: 'avatars/avatar-uid-1.jpg',
    });
    expect(storageRefFromUrl(`${BASE}/post-media/old/file.mp4`)).toEqual({
      bucket: 'post-media',
      path: 'old/file.mp4',
    });
  });

  it('strips querystrings and fragments', () => {
    expect(storageRefFromUrl(`${BASE}/uploads/covers/uid/1.webp?width=600#x`)).toEqual({
      bucket: 'uploads',
      path: 'covers/uid/1.webp',
    });
  });

  it('decodes encoded paths', () => {
    expect(storageRefFromUrl(`${BASE}/uploads/posts/uid/my%20file.png`)).toEqual({
      bucket: 'uploads',
      path: 'posts/uid/my file.png',
    });
  });

  it('returns null for external hosts and non-storage URLs', () => {
    expect(storageRefFromUrl('https://example.com/image.png')).toBeNull();
    expect(storageRefFromUrl('not a url')).toBeNull();
    expect(storageRefFromUrl(null)).toBeNull();
    expect(storageRefFromUrl(undefined)).toBeNull();
    expect(storageRefFromUrl('')).toBeNull();
  });

  it('NEVER returns consent-evidence refs (compliance denylist)', () => {
    expect(storageRefFromUrl(`${BASE}/consent-evidence/child-id/123.pdf`)).toBeNull();
  });
});
