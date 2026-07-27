/**
 * The one post-media upload call (browser-only). Replaces the FormData block
 * that was copy-pasted across five surfaces. Editor output or original file
 * in, public URL out — auth comes from the session cookie server-side.
 */

export interface UploadedMedia {
  url: string;
  type: 'image' | 'video';
}

export async function uploadPostMedia(file: File): Promise<UploadedMedia> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/upload/post-media', { method: 'POST', body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) {
    throw new Error(payload.error || 'Failed to upload media');
  }
  return { url: payload.url, type: payload.type === 'video' ? 'video' : 'image' };
}
