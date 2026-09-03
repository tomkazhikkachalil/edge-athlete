/**
 * HTTP client for a self-hosted AI runner (Phase 3 scaffold) — the ONLY
 * runner implementation. It speaks the small protocol documented in
 * docs/AI_RUNNER.md and validates every response with zod (an AI endpoint
 * is still an untrusted input). Every failure returns null — the editor
 * treats that as "no result", never as an error state the user has to
 * manage.
 */

import { z } from 'zod';
import { MAX_DATA_MASK_DIM, MAX_RLE_LENGTH, decodeMaskRle } from '../engine/mask-rle';
import type { AiRunner, SegmentSubjectResult } from './types';

const segmentResponseSchema = z.object({
  width: z.number().int().min(8).max(MAX_DATA_MASK_DIM),
  height: z.number().int().min(8).max(MAX_DATA_MASK_DIM),
  rle: z.string().min(1).max(MAX_RLE_LENGTH),
});

const REQUEST_TIMEOUT_MS = 30_000;

export function createRemoteRunner(endpoint: string, fetchImpl: typeof fetch = fetch): AiRunner {
  const base = endpoint.replace(/\/$/, '');
  return {
    endpoint: base,
    async segmentSubject(image: Blob): Promise<SegmentSubjectResult | null> {
      // AbortController + setTimeout rather than AbortSignal.timeout (Safari
      // 16+): this chunk ships to the browser and the floor is iOS 15.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetchImpl(`${base}/segment`, {
          method: 'POST',
          headers: { 'Content-Type': image.type || 'application/octet-stream' },
          body: image,
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const parsed = segmentResponseSchema.safeParse(await response.json());
        if (!parsed.success) return null;
        // The RLE must actually decode at the claimed dimensions — a
        // malformed mask degrades to nothing, never to garbage weights.
        if (!decodeMaskRle(parsed.data.rle, parsed.data.width, parsed.data.height)) return null;
        return parsed.data;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
