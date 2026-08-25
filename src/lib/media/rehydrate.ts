// Re-edit after publish (browser-only): turn a post_media row back into a
// MediaAsset the editor can open. Edits start from the untouched ORIGINAL
// when we have one (source_url); a pre-120 row's media_url IS its original
// (null semantics, migration 120). The stored recipe only rehydrates when
// it describes a transform OF the file we are opening — a recipe without
// its source would double-apply onto the render.

import { parseRecipeEnvelope } from './recipes';
import type { MediaAsset } from './types';

export interface EditablePostMediaRow {
  id: string;
  media_url: string;
  media_type: 'image' | 'video';
  thumbnail_url: string | null;
  source_url: string | null;
  edit_recipe: unknown;
}

export async function assetFromRemote(row: EditablePostMediaRow): Promise<MediaAsset> {
  const url = row.source_url ?? row.media_url;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load the media file');
  const blob = await res.blob();
  const name =
    url.split('/').pop()?.split('?')[0] || (row.media_type === 'video' ? 'video.mp4' : 'image.jpg');
  const type = blob.type || (row.media_type === 'video' ? 'video/mp4' : 'image/jpeg');
  const file = new File([blob], name, { type });
  const recipe = row.source_url ? (parseRecipeEnvelope(row.edit_recipe) ?? undefined) : undefined;
  return { id: row.id, file, kind: row.media_type, recipe };
}
