/**
 * Client-safe cover URL helper. NO crypto import (unlike proxy-url.ts), so it is
 * safe in the client bundle.
 *
 * Cover photos live in the now-private `uploads` bucket, so their raw
 * `/object/public/uploads/…` URLs 404. Covers are PUBLIC by decision, but the
 * own-profile page loads its profile client-side (via useAuth), where a signed
 * media-proxy token can't be minted. So covers are served through a tokenless,
 * public, per-profile endpoint keyed by profile id — `/api/media/cover/[id]` —
 * which looks up that profile's cover and streams only that object (it can never
 * be pointed at arbitrary private media). Usable identically from client and
 * server.
 *
 * The `?v` segment busts the browser/CDN cache when a new cover is uploaded:
 * `cover_url` carries the timestamped object filename, which changes each upload.
 * The endpoint ignores `v` (it resolves the cover itself); it exists only so the
 * stable `/api/media/cover/<id>` URL refreshes when the underlying cover changes.
 */
export function coverProxyUrl(
  profileId: string | null | undefined,
  coverUrl: string | null | undefined
): string | null {
  if (!profileId || !coverUrl) return null;
  const seg = coverUrl.split('?')[0].split('/').pop() || '';
  return `/api/media/cover/${profileId}${seg ? `?v=${encodeURIComponent(seg)}` : ''}`;
}
