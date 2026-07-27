/**
 * Asset → EditedMedia (browser-only). The editor's Done handler runs this
 * SEQUENTIALLY per asset — never in parallel; ten simultaneous 12MP decodes
 * is how mobile Safari tabs die.
 *
 * Pass-through rules: videos (until the video phase ships), GIFs (canvas
 * would kill the animation), and no-op recipes upload the ORIGINAL file —
 * but only when the server allowlist accepts its type. HEIC is never
 * passed through: it must re-encode (that's what makes it uploadable).
 */

import { isNoopRecipe } from './recipes';
import { renderImage, renderedFileName } from './render';
import { isServerAllowedType } from './validation';
import { capturePoster } from './poster';
import type { EditRecipe, EditedMedia, MediaAsset, OutputConfig } from './types';

export function passThrough(asset: MediaAsset, recipe: EditRecipe): EditedMedia {
  return {
    id: asset.id,
    blob: asset.file,
    file: asset.file,
    previewUrl: URL.createObjectURL(asset.file),
    kind: asset.kind,
    sourceFile: asset.file,
    recipe,
    edited: false,
  };
}

async function exportVideo(asset: MediaAsset, recipe: EditRecipe): Promise<EditedMedia> {
  if (recipe.kind !== 'video') return passThrough(asset, recipe);

  // Poster always captured (plain canvas — works without WebCodecs); it's
  // optional, so a capture failure never blocks the video itself.
  let posterBlob: Blob | undefined;
  try {
    posterBlob = await capturePoster(asset.file, recipe.posterTime);
  } catch (err) {
    console.warn('Poster capture failed:', err);
  }

  if (recipe.trim) {
    try {
      const { isVideoEditingSupported, trimVideo } = await import('./video');
      if (isVideoEditingSupported()) {
        const { blob, mime } = await trimVideo(asset.file, recipe.trim);
        const base = asset.file.name.replace(/\.[^.]+$/, '') || 'video';
        const file = new File([blob], `${base}-edited.mp4`, { type: mime });
        return {
          id: asset.id,
          blob,
          file,
          previewUrl: URL.createObjectURL(blob),
          kind: 'video',
          posterBlob,
          sourceFile: asset.file,
          recipe,
          edited: true,
        };
      }
    } catch (err) {
      // Trim failed (unsupported codec/browser) → the original still uploads
      console.warn('Video trim failed, uploading original:', err);
    }
  }
  return { ...passThrough(asset, recipe), posterBlob };
}

export async function exportAsset(
  asset: MediaAsset,
  recipe: EditRecipe,
  output: OutputConfig
): Promise<EditedMedia> {
  const serverAllowed = isServerAllowedType(asset.file.type);
  const isGif = asset.file.type === 'image/gif';

  if (asset.kind === 'video') return exportVideo(asset, recipe);
  if (isGif || (recipe.kind === 'image' && isNoopRecipe(recipe) && serverAllowed)) {
    return passThrough(asset, recipe);
  }
  if (recipe.kind !== 'image') return passThrough(asset, recipe);

  const blob = await renderImage(asset.file, recipe, output);
  // Trust the blob's real type: Safari's toBlob silently falls back to PNG
  // for encoders it lacks — the File's name/type must match actual bytes.
  const mime = blob.type || output.mime;
  const file = new File([blob], renderedFileName(asset.file.name, mime), { type: mime });
  return {
    id: asset.id,
    blob,
    file,
    previewUrl: URL.createObjectURL(blob),
    kind: 'image',
    sourceFile: asset.file,
    recipe,
    edited: true,
  };
}
