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

export async function exportAsset(
  asset: MediaAsset,
  recipe: EditRecipe,
  output: OutputConfig
): Promise<EditedMedia> {
  const serverAllowed = isServerAllowedType(asset.file.type);
  const isGif = asset.file.type === 'image/gif';

  if (
    asset.kind === 'video' ||
    isGif ||
    (recipe.kind === 'image' && isNoopRecipe(recipe) && serverAllowed)
  ) {
    return passThrough(asset, recipe);
  }
  if (recipe.kind !== 'image') return passThrough(asset, recipe);

  const blob = await renderImage(asset.file, recipe, output);
  const file = new File([blob], renderedFileName(asset.file.name, output.mime), {
    type: output.mime,
  });
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
