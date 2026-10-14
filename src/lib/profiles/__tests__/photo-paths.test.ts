import { describe, expect, it } from 'vitest';
import { managedProfilePhotoPath } from '../photo-paths';

const B = 'https://proj.supabase.co/storage/v1/object/public';

describe('managedProfilePhotoPath — only our buckets under our prefixes', () => {
  it('an avatar in any of the four legacy buckets', () => {
    for (const bucket of ['avatars', 'uploads', 'images', 'files']) {
      expect(managedProfilePhotoPath(`${B}/${bucket}/avatars/avatar-u1-1.jpg`, 'avatar')).toEqual({ bucket, path: 'avatars/avatar-u1-1.jpg' });
    }
  });
  it('a cover only in uploads under covers/', () => {
    expect(managedProfilePhotoPath(`${B}/uploads/covers/u1/1.jpg`, 'cover')).toEqual({ bucket: 'uploads', path: 'covers/u1/1.jpg' });
    expect(managedProfilePhotoPath(`${B}/avatars/covers/u1/1.jpg`, 'cover')).toBeNull();
  });
  it('a lookalike bucket, the wrong prefix, a Google avatar and nothing are never ours', () => {
    expect(managedProfilePhotoPath(`${B}/uploads2/avatars/a.jpg`, 'avatar')).toBeNull();
    expect(managedProfilePhotoPath(`${B}/uploads/posts/u1/a.jpg`, 'avatar')).toBeNull();
    expect(managedProfilePhotoPath('https://lh3.googleusercontent.com/a/abc=s96-c', 'avatar')).toBeNull();
    expect(managedProfilePhotoPath(null, 'cover')).toBeNull();
    expect(managedProfilePhotoPath('', 'cover')).toBeNull();
  });
  it('a query string and percent-encoding are handled', () => {
    expect(managedProfilePhotoPath(`${B}/uploads/covers/u1/a%20b.jpg?v=1`, 'cover')).toEqual({ bucket: 'uploads', path: 'covers/u1/a b.jpg' });
  });
});
