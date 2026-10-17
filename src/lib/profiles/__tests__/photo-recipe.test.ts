import { describe, it, expect } from 'vitest';
import {
  keepSourceAsIs,
  parseProfilePhotoRecipe,
  PROFILE_PHOTO_BODY_BUDGET,
  PROFILE_SOURCE_KEEP_MAX_BYTES,
  profilePhotoRecipeEnvelope,
  profileSourcePath,
  profileSourceProxyUrl,
  sourceFitsRequest,
} from '../photo-recipe';
import { defaultImageRecipe, defaultVideoRecipe, recipeEnvelope } from '@/lib/media/recipes';

describe('parseProfilePhotoRecipe', () => {
  it('accepts the editor envelope of an image recipe', () => {
    const recipe = { ...defaultImageRecipe('1:1'), crop: { x: 1, y: 2, width: 30, height: 30 } };
    expect(parseProfilePhotoRecipe(profilePhotoRecipeEnvelope(recipe))).toEqual(recipe);
  });
  it('refuses a video recipe, garbage and nothing', () => {
    expect(parseProfilePhotoRecipe(recipeEnvelope(defaultVideoRecipe()))).toBeNull();
    expect(parseProfilePhotoRecipe({ v: 3, recipe: { kind: 'image' } })).toBeNull();
    expect(parseProfilePhotoRecipe('{}')).toBeNull();
    expect(parseProfilePhotoRecipe(null)).toBeNull();
    expect(parseProfilePhotoRecipe(undefined)).toBeNull();
  });
});

describe('the kept original paths', () => {
  it('lives under profile-sources/{profile}/{slot}-{ts}.jpg', () => {
    expect(profileSourcePath('p1', 'avatar', 1700000000000)).toBe('profile-sources/p1/avatar-1700000000000.jpg');
    expect(profileSourcePath('p1', 'cover', 5)).toBe('profile-sources/p1/cover-5.jpg');
    expect(profileSourcePath('p1', 'cover', 5, 'png')).toBe('profile-sources/p1/cover-5.png');
  });
  it('the proxy URL names the slot and busts on the file name', () => {
    expect(profileSourceProxyUrl('p1', 'cover', 'https://x.supabase.co/storage/v1/object/public/uploads/profile-sources/p1/cover-5.jpg')).toBe(
      '/api/media/profile-source/p1?slot=cover&v=cover-5.jpg'
    );
    expect(profileSourceProxyUrl('p1', 'avatar', null)).toBeNull();
    expect(profileSourceProxyUrl('', 'avatar', 'x')).toBeNull();
  });
});

describe('the photo and its original fit one Vercel request (every-browser round, Oct 16 2026)', () => {
  const MB = 1024 * 1024;
  it('keeps a pick as the original only when it is a small JPEG / PNG / WebP within 2048 px', () => {
    expect(keepSourceAsIs('image/jpeg', 1.8 * MB, 2048)).toBe(true);
    expect(keepSourceAsIs('image/webp', 0.4 * MB, 1200)).toBe(true);
    // The reported shape: a 2000 px PNG wallpaper of 8 MB — re-encoded, never sent as-is.
    expect(keepSourceAsIs('image/png', 8 * MB, 2000)).toBe(false);
    expect(keepSourceAsIs('image/png', PROFILE_SOURCE_KEEP_MAX_BYTES + 1, 1000)).toBe(false);
    expect(keepSourceAsIs('image/jpeg', 1 * MB, 4032)).toBe(false); // a 12 MP capture
    expect(keepSourceAsIs('image/heic', 1 * MB, 1000)).toBe(false);
    expect(keepSourceAsIs('image/jpeg', 1 * MB, null)).toBe(false); // dimensions unknown
  });
  it('sends the original only while render + original stay under the budget, itself under 4.5 MB', () => {
    expect(PROFILE_PHOTO_BODY_BUDGET).toBeLessThan(4.5 * MB);
    expect(PROFILE_SOURCE_KEEP_MAX_BYTES + 1.5 * MB).toBeLessThanOrEqual(PROFILE_PHOTO_BODY_BUDGET); // a kept original + a 1500 px render fit
    expect(sourceFitsRequest(0.8 * MB, 2.5 * MB)).toBe(true);
    expect(sourceFitsRequest(1.2 * MB, 3.2 * MB)).toBe(false);
  });
});
