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

export function grabPosterInto(queue: UploadQueue, localId: string, file: File, deadlineMs: number = POSTER_GRAB_DEADLINE_MS): void {
  if (!file.type.startsWith('video/')) return;
  void queue.device(async () => {
    let timer: number | null = null;
    try {
      const blob = await Promise.race([
        import('@/lib/media/poster').then(({ capturePoster }) => capturePoster(file, posterTimeFor(null))),
        new Promise<null>(resolve => { timer = window.setTimeout(() => resolve(null), deadlineMs); }),
      ]);
      if (blob) queue.attachPoster(localId, blob);
    } catch {
      /* no poster — the clip is still the clip */
    } finally {
      if (timer !== null) window.clearTimeout(timer);
    }
  });
}
