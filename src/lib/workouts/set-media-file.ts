/**
 * A stored set clip as a File for the editor (the pencil — Oct 4 2026, lifted
 * out of the set row for the share step on Oct 8). The URL a set carries is
 * a media-proxy path; fetched WITH the viewer's cookie it answers the bytes,
 * and the editor's Done re-uploads the result, which REPLACES the clip.
 * Client-only (fetch + File).
 */
export async function fetchStoredMediaFile(
  url: string,
  type: 'image' | 'video',
  init: { credentials: RequestCredentials } = { credentials: 'include' }
): Promise<File> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error('Could not open the media');
  const blob = await res.blob();
  const fallbackMime = type === 'video' ? 'video/mp4' : 'image/jpeg';
  const mime = blob.type || fallbackMime;
  const ext = mime.split('/')[1] || (type === 'video' ? 'mp4' : 'jpg');
  return new File([blob], `set-media.${ext}`, { type: mime });
}
