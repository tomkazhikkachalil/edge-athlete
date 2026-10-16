import { describe, it, expect } from 'vitest';
import {
  parseProfilePhotoRecipe,
  profilePhotoRecipeEnvelope,
  profileSourcePath,
  profileSourceProxyUrl,
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
