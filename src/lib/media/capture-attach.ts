/**
 * Capture v2 (Sep 3 2026): a camera capture ATTACHES IMMEDIATELY as a tile;
 * the editor is one tap away, never mandatory. Pure planning helper — the
 * composer owns object URLs and state.
 *
 * Why: the old process opened the editor on every capture, which for a video
 * meant three <video> elements, eight seeks and eight JPEG encodes for
 * thumbnails, a full container parse for "30fps", a poster capture, a
 * metadata probe and then a whole-file re-mux in memory — all on the main
 * thread of a phone, before the user saw anything. That is where a
 * 5-second clip froze. Attaching first costs one object URL.
 *
 * The one exception: HEIC/HEIF must re-encode (the server never accepts it),
 * so those still open the editor, which converts on export.
 */

import { requiresReencode } from './validation';

export interface CaptureAttachPlan {
  /** Attach as tiles now — the original File is the tile and the upload. */
  attach: File[];
  /** Must go through the editor first (re-encode-only formats). */
  editor: File[];
}

export function planCaptureAttach(accepted: File[]): CaptureAttachPlan {
  return planPickAttach(accepted, 'camera');
}

/**
 * Where a pick came from decides what attaches at once (Oct 4 2026, the
 * direct-upload round): a CAMERA capture attaches everything the server
 * takes; a LIBRARY pick attaches its VIDEOS and keeps photos editor-first.
 * Why videos: opening the editor on a library video cost three <video>
 * loads, eight thumbnail seeks, a container parse, then a probe and a poster
 * capture on Done — on a phone that read as "uploading is incredibly slow"
 * before a byte had left the device. The editor stays one tap away on the
 * tile. Photos keep the editor-first flow (a library photo is usually
 * cropped or straightened; the editor IS the pick). HEIC always re-encodes.
 */
export function planPickAttach(accepted: File[], source: 'camera' | 'library'): CaptureAttachPlan {
  const plan: CaptureAttachPlan = { attach: [], editor: [] };
  for (const file of accepted) {
    if (requiresReencode(file.type)) plan.editor.push(file);
    else if (source === 'camera' || file.type.startsWith('video/')) plan.attach.push(file);
    else plan.editor.push(file);
  }
  return plan;
}

/** A finite, positive duration in seconds, or null (MediaRecorder files report Infinity until seeked). */
export function usableDuration(seconds: number): number | null {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
