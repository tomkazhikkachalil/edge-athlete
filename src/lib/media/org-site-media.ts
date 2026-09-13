/**
 * Client-safe org-site media URL helpers (phase 3 R3). NO crypto import
 * (unlike proxy-url.ts) — safe in the client bundle and in ISR server
 * components alike.
 *
 * Org logos live in the private `uploads` bucket under org-logos/{siteId}/
 * and are served through the tokenless public streamer
 * /api/media/org-logo/[siteId] (the cover-url recipe: the endpoint
 * resolves the object itself; `?v` carries the timestamped filename purely
 * as a cache-buster so the stable URL refreshes on re-upload).
 */
export function orgLogoUrl(
  siteId: string | null | undefined,
  logoPath: string | null | undefined
): string | null {
  if (!siteId || !logoPath) return null;
  const seg = logoPath.split('?')[0].split('/').pop() || '';
  return `/api/media/org-logo/${siteId}${seg ? `?v=${encodeURIComponent(seg)}` : ''}`;
}

/** A base64 SVG data URI — the editor's sample media (site-builder/sample.ts).
 *  Base64-only and SVG-only: script-inert inside an `<img src>`, and no
 *  write path admits it (the stored-path regexes are all `org-media/…`). */
export const SAMPLE_MEDIA_URI_RE = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]{1,12000}$/;

/**
 * Page-image asset URL: org-media/{siteId}/{file} → the tokenless
 * /api/media/org-media/[siteId]/[file] streamer. Filenames are uuid-named
 * and immutable, so no `?v` is needed. Returns null for anything that
 * isn't a well-formed stored asset path.
 */
export function orgMediaUrl(
  siteId: string | null | undefined,
  assetPath: string | null | undefined
): string | null {
  if (!siteId || !assetPath) return null;
  // Program 3 S1: the editor's SAMPLE media are inline base64 SVGs; they
  // pass through for render only. A stored path can never be one — every
  // write path is a regex on `org-media/{siteId}/…` (ORG_MEDIA_PATH_RE).
  if (SAMPLE_MEDIA_URI_RE.test(assetPath)) return assetPath;
  const file = assetPath.split('/').pop() || '';
  if (!assetPath.startsWith(`org-media/${siteId}/`) || !file) return null;
  return `/api/media/org-media/${siteId}/${file}`;
}
