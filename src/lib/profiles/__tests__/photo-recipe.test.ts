import { describe, it, expect } from 'vitest';
import {
  centeredCrop,
  captureRecipe,
  parseProfilePhotoRecipe,
  profilePhotoRecipeEnvelope,
  profileSourcePath,
  profileSourceProxyUrl,
  SLOT_ASPECT,
} from '../photo-recipe';
import { defaultImageRecipe, defaultVideoRecipe, recipeEnvelope } from '@/lib/media/recipes';

describe('centeredCrop', () => {
  it('a landscape photo cropped square takes the full height, centred', () => {
    expect(centeredCrop(4000, 3000, 1)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
  });
  it('a portrait photo cropped square takes the full width, centred', () => {
    expect(centeredCrop(3000, 4000, 1)).toEqual({ x: 0, y: 500, width: 3000, height: 3000 });
  });
  it('a 3:1 banner out of a 4:3 photo takes the full width', () => {
    expect(centeredCrop(4000, 3000, 3)).toEqual({ x: 0, y: 833, width: 4000, height: 1333 });
  });
  it('a 3:1 banner out of a very wide photo takes the full height', () => {
    expect(centeredCrop(9000, 1000, 3)).toEqual({ x: 3000, y: 0, width: 3000, height: 1000 });
  });
  it('never exceeds the image and never collapses to zero', () => {
    const c = centeredCrop(1, 1, 3);
    expect(c.width).toBe(1);
    expect(c.height).toBe(1);
    const d = centeredCrop(0, 0, 1);
    expect(d.width).toBe(1);
    expect(d.height).toBe(1);
  });
});

describe('captureRecipe', () => {
  it('is the slot ratio with the centred crop and nothing else', () => {
    const r = captureRecipe('avatar', 4000, 3000);
    expect(r.aspect).toBe('1:1');
    expect(r.crop).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
    expect({ ...r, crop: null, aspect: 'free' }).toEqual(defaultImageRecipe('free'));
    expect(captureRecipe('cover', 4000, 3000).aspect).toBe(SLOT_ASPECT.cover.id);
  });
});

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
