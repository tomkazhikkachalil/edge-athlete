import { describe, it, expect } from 'vitest';
import {
  GRACE_MS,
  SWEEP_BUCKETS,
  bucketPathFromUrl,
  collectSetMediaPaths,
  isSweepable,
  uploadsPathFromUrl,
} from '../storage-sweep';

const SB = 'https://abc.supabase.co/storage/v1/object/public';

describe('uploadsPathFromUrl', () => {
  it('extracts the path from uploads public URLs', () => {
    expect(uploadsPathFromUrl(`${SB}/uploads/posts/u1/a.png`)).toBe('posts/u1/a.png');
    expect(uploadsPathFromUrl(`${SB}/uploads/u1/b.mp4`)).toBe('u1/b.mp4');
  });

  it('strips query/hash and decodes percent-encoding', () => {
    expect(uploadsPathFromUrl(`${SB}/uploads/posts/u1/a.png?width=100`)).toBe('posts/u1/a.png');
    expect(uploadsPathFromUrl(`${SB}/uploads/posts/u1/a%20b.png`)).toBe('posts/u1/a b.png');
  });

  it('returns null for other buckets, hosts, and junk', () => {
    expect(uploadsPathFromUrl(`${SB}/avatars/u1/a.png`)).toBeNull();
    expect(uploadsPathFromUrl('https://media.giphy.com/x.gif')).toBeNull();
    expect(uploadsPathFromUrl(null)).toBeNull();
    expect(uploadsPathFromUrl('')).toBeNull();
    expect(uploadsPathFromUrl(42)).toBeNull();
  });
});

describe('bucketPathFromUrl', () => {
  it('extracts paths per bucket and ignores other buckets', () => {
    expect(bucketPathFromUrl(`${SB}/avatars/avatars/a-1.png`, 'avatars')).toBe('avatars/a-1.png');
    expect(bucketPathFromUrl(`${SB}/uploads/posts/u1/a.png`, 'avatars')).toBeNull();
    expect(bucketPathFromUrl(`${SB}/avatars/avatars/a-1.png`, 'uploads')).toBeNull();
  });

  it('strips query/hash and decodes, same as the uploads shorthand', () => {
    expect(bucketPathFromUrl(`${SB}/avatars/a%20b.png?v=2`, 'avatars')).toBe('a b.png');
    expect(uploadsPathFromUrl(`${SB}/uploads/posts/u1/a.png`)).toBe('posts/u1/a.png');
  });

  it('does not let one bucket name prefix-match another', () => {
    // The trailing slash in the marker is what prevents this.
    expect(bucketPathFromUrl(`${SB}/uploads2/x.png`, 'uploads')).toBeNull();
    expect(bucketPathFromUrl(`${SB}/avatars-old/x.png`, 'avatars')).toBeNull();
  });

  it('returns null for junk and for a bucket URL with no path after it', () => {
    expect(bucketPathFromUrl(`${SB}/avatars/`, 'avatars')).toBeNull();
    expect(bucketPathFromUrl(null, 'avatars')).toBeNull();
    expect(bucketPathFromUrl(42, 'uploads')).toBeNull();
  });
});

describe('SWEEP_BUCKETS', () => {
  it('never includes consent-evidence — it is the legal audit trail for minors', () => {
    expect(SWEEP_BUCKETS).not.toContain('consent-evidence');
  });

  it('covers avatars, or deleting a user orphans their avatar forever', () => {
    expect(SWEEP_BUCKETS).toContain('avatars');
    expect(SWEEP_BUCKETS).toContain('uploads');
  });
});

describe('collectSetMediaPaths', () => {
  it('collects urls from jsonb media arrays, skipping junk shapes', () => {
    const paths = collectSetMediaPaths([
      [{ url: `${SB}/uploads/posts/u1/clip.mp4`, type: 'video' }],
      [{ url: 'https://elsewhere.com/x.png', type: 'image' }, { nope: true }],
      'not-an-array',
      null,
      [],
    ]);
    expect(paths).toEqual(['posts/u1/clip.mp4']);
  });
});

describe('isSweepable', () => {
  const now = Date.parse('2026-07-27T00:00:00Z');
  const old = new Date(now - GRACE_MS - 60_000).toISOString();
  const fresh = new Date(now - 60_000).toISOString();

  it('sweeps old unreferenced files only', () => {
    const refs = new Set(['posts/u1/kept.png']);
    expect(isSweepable({ path: 'posts/u1/orphan.png', createdAt: old }, refs, now)).toBe(true);
    expect(isSweepable({ path: 'posts/u1/kept.png', createdAt: old }, refs, now)).toBe(false);
  });

  it('never sweeps inside the grace period or without a timestamp', () => {
    const refs = new Set<string>();
    expect(isSweepable({ path: 'posts/u1/new.png', createdAt: fresh }, refs, now)).toBe(false);
    expect(isSweepable({ path: 'posts/u1/x.png', createdAt: null }, refs, now)).toBe(false);
    expect(isSweepable({ path: 'posts/u1/x.png', createdAt: 'garbage' }, refs, now)).toBe(false);
  });
});
