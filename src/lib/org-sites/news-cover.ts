import { firstImage } from './public-data';
import { orgMediaUrl } from '@/lib/media/org-site-media';

/**
 * A news post's cover for the in-app card (Org Pages R4): the public site's
 * `firstImage` rule (the first image block under org-media/) mapped through
 * the same prefix-re-asserting URL helper the site uses — a block whose
 * path belongs to another site reads as no cover. Pure; node-tested.
 */
export interface AppNewsCover {
  url: string;
  alt: string;
  width?: number;
  height?: number;
}

export function resolveNewsCover(siteId: string, body: unknown): AppNewsCover | null {
  const cover = firstImage(body);
  if (!cover) return null;
  const url = orgMediaUrl(siteId, cover.path);
  if (!url) return null;
  const out: AppNewsCover = { url, alt: cover.alt };
  if (cover.width) out.width = cover.width;
  if (cover.height) out.height = cover.height;
  return out;
}
