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
  const file = assetPath.split('/').pop() || '';
  if (!assetPath.startsWith(`org-media/${siteId}/`) || !file) return null;
  return `/api/media/org-media/${siteId}/${file}`;
}
