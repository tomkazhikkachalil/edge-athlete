/**
 * A video clip's poster, grabbed on the queue's DEVICE chain after its tile
 * (video posters PR 3, Oct 13 2026) — the one grab the workout clips, the
 * activity page and the recorder share. `posterTimeFor` says where (about
 * one second in); the deadline bounds a slow decode; a miss leaves the clip
 * without a poster (the server job fills it later); a photo is ignored.
 * Browser-only (the capture needs a <video> and a canvas).
 */

import { POSTER_GRAB_DEADLINE_MS, posterTimeFor } from '@/lib/media/poster-plan';
import type { UploadQueue } from '@/lib/media/upload-queue';

/** The blurred placeholder (PR 6): a ThumbHash of a picture — an image, or a video's poster — on the device chain; a miss is nothing. */
export function grabBlurInto(queue: UploadQueue, localId: string, picture: Blob): void {
  void queue.device(async () => {
    try {
      const { blurHashFromBlob } = await import('@/lib/media/blur');
      const hash = await blurHashFromBlob(picture);
      if (hash) queue.attachBlur(localId, hash);
    } catch {
      /* no blur — the picture still loads */
    }
  });
}

export function grabPosterInto(queue: UploadQueue, localId: string, file: File, deadlineMs: number = POSTER_GRAB_DEADLINE_MS): void {
  if (!file.type.startsWith('video/')) return;
  void queue.device(async () => {
    let timer: number | null = null;
    try {
      const blob = await Promise.race([
        import('@/lib/media/poster').then(({ capturePoster }) => capturePoster(file, posterTimeFor(null))),
        new Promise<null>(resolve => { timer = window.setTimeout(() => resolve(null), deadlineMs); }),
      ]);
      if (blob) {
        queue.attachPoster(localId, blob);
        grabBlurInto(queue, localId, blob); // the clip's blur is its poster's
      }
    } catch {
      /* no poster — the clip is still the clip */
    } finally {
      if (timer !== null) window.clearTimeout(timer);
    }
  });
}

/** Both at once for a picked file: a clip's poster (and its blur), a photo's blur. */
export function grabPreviewsInto(queue: UploadQueue, localId: string, file: File): void {
  if (file.type.startsWith('video/')) grabPosterInto(queue, localId, file);
  else if (file.type.startsWith('image/')) grabBlurInto(queue, localId, file);
}
