import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  keepSourceAsIs,
  parseProfilePhotoRecipe,
  PROFILE_SOURCE_KEEP_MAX_BYTES,
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

describe('the kept original is bounded by the server, not a request (Nov 2 2026 — the bytes go direct to storage)', () => {
  const MB = 1024 * 1024;
  it('keeps a pick as the original only when it is a JPEG / PNG / WebP within 2048 px and within the 10 MB cap', () => {
    expect(keepSourceAsIs('image/jpeg', 2 * MB, 2048)).toBe(true);
    expect(keepSourceAsIs('image/png', 9 * MB, 1600)).toBe(true);
    expect(keepSourceAsIs('image/png', PROFILE_SOURCE_KEEP_MAX_BYTES + 1, 1000)).toBe(false);
    expect(keepSourceAsIs('image/jpeg', 1 * MB, 2049)).toBe(false);
    expect(keepSourceAsIs('image/gif', 1 * MB, 500)).toBe(false);
    expect(keepSourceAsIs('image/jpeg', 1 * MB, null)).toBe(false);
  });
  it('the cap is the server\'s cap on a kept original, and no request budget remains', () => {
    expect(PROFILE_SOURCE_KEEP_MAX_BYTES).toBe(10 * MB);
    const client = fs.readFileSync(path.join(process.cwd(), 'src/lib/profiles/photo-upload-client.ts'), 'utf8');
    expect(client).not.toContain('FormData');
    expect(client).toContain("fetch('/api/profile/photo'");
    expect(client).toContain('stageUpload(');
  });
});
