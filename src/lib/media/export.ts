/**
 * Asset → EditedMedia (browser-only). The editor's Done handler runs this
 * SEQUENTIALLY per asset — never in parallel; ten simultaneous 12MP decodes
 * is how mobile Safari tabs die.
 *
 * Pass-through rules: untrimmed or WebCodecs-less videos, GIFs (canvas
 * would kill the animation), and no-op recipes upload the ORIGINAL file —
 * but only when the server allowlist accepts its type. HEIC is never
 * passed through: it must re-encode (that's what makes it uploadable).
 *
 * Every result is metadata-probed best-effort (width/height/duration →
 * post_media); a probe failure never blocks the export.
 */

import { isNoopRecipe } from './recipes';
import { renderImage, renderedFileName } from './render';
import { isServerAllowedType } from './validation';
import { capturePoster } from './poster';
import { probeImageDims, probeVideoMeta } from './probe';
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

/** Best-effort width/height/duration on the OUTPUT blob. Never throws. */
async function withMeta(result: EditedMedia): Promise<EditedMedia> {
  if (result.kind === 'video') {
    const meta = await probeVideoMeta(result.blob);
    return meta ? { ...result, ...meta } : result;
  }
  const dims = await probeImageDims(result.blob);
  return dims ? { ...result, ...dims } : result;
}

async function exportVideo(asset: MediaAsset, recipe: EditRecipe): Promise<EditedMedia> {
  if (recipe.kind !== 'video') return passThrough(asset, recipe);

  if (!isNoopRecipe(recipe)) {
    try {
      const { isVideoEditingSupported, renderVideoRecipe } = await import('./video');
      if (isVideoEditingSupported()) {
        const { probeVideoMeta } = await import('./probe');
        const meta = await probeVideoMeta(asset.file);
        const { blob, mime } = await renderVideoRecipe(
          asset.file,
          recipe,
          meta?.durationSeconds ?? 0
        );
        const base = asset.file.name.replace(/\.[^.]+$/, '') || 'video';
        const file = new File([blob], `${base}-edited.mp4`, { type: mime });
        // Poster from the RENDERED output: posterTime is timeline-space, and
        // the rendered file IS the timeline — no clip mapping needed.
        let posterBlob: Blob | undefined;
        try {
          posterBlob = await capturePoster(file, recipe.posterTime);
        } catch (err) {
          console.warn('Poster capture failed:', err);
        }
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
      // Render failed (unsupported codec/browser) → the original still uploads
      console.warn('Video render failed, uploading original:', err);
    }
  }

  // Pass-through: poster comes from the ORIGINAL, so map the timeline-space
  // posterTime back into source time through the clips (plain canvas — works
  // without WebCodecs; failure never blocks the video).
  let posterBlob: Blob | undefined;
  try {
    const { timelineToSource } = await import('./timeline-math');
    const posterSourceTime =
      recipe.clips.length > 0
        ? (timelineToSource(recipe.posterTime, recipe.clips)?.sourceTime ?? recipe.clips[0].in)
        : recipe.posterTime;
    posterBlob = await capturePoster(asset.file, posterSourceTime);
  } catch (err) {
    console.warn('Poster capture failed:', err);
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

  if (asset.kind === 'video') return withMeta(await exportVideo(asset, recipe));
  if (isGif || (recipe.kind === 'image' && isNoopRecipe(recipe) && serverAllowed)) {
    return withMeta(passThrough(asset, recipe));
  }
  if (recipe.kind !== 'image') return withMeta(passThrough(asset, recipe));

  const blob = await renderImage(asset.file, recipe, output);
  // Trust the blob's real type: Safari's toBlob silently falls back to PNG
  // for encoders it lacks — the File's name/type must match actual bytes.
  const mime = blob.type || output.mime;
  const file = new File([blob], renderedFileName(asset.file.name, mime), { type: mime });
  return withMeta({
    id: asset.id,
    blob,
    file,
    previewUrl: URL.createObjectURL(blob),
    kind: 'image',
    sourceFile: asset.file,
    recipe,
    edited: true,
  });
}
