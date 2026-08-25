/**
 * Decides whether a given image `src` may go through Next's image optimizer.
 * Pure — unit-tested.
 *
 * MIRRORS `next.config.ts` → `images.remotePatterns`. If that allowlist ever
 * changes, change this with it; the tests below pin both halves so drift is
 * visible rather than silent.
 *
 * Passing an un-allowlisted host to <Image> is not a soft failure: Next throws
 * in dev ("hostname ... is not configured") and `/_next/image` 400s in prod,
 * i.e. a broken image. Google OAuth signups store `lh3.googleusercontent.com`
 * avatars verbatim (see `deriveAvatarUrl` in lib/oauth-profile.ts, written by
 * api/auth/complete-profile), so any <Image> rendering `profiles.avatar_url`
 * MUST guard with this helper: `unoptimized={!isOptimizableImageSrc(src)}`.
 *
 * Giphy is deliberately excluded even though `**.giphy.com` IS allowlisted:
 * the optimizer streams animated GIF/WebP/APNG through untouched, so routing
 * them via `/_next/image` saves zero bytes while spending a billable Vercel
 * Image Optimization transformation per source-per-size.
 */

/** Supabase Storage serves optimizable originals from this path prefix only. */
const SUPABASE_OBJECT_PREFIX = '/storage/v1/object/';

/** Storage hosts Next is configured to fetch from. */
const SUPABASE_HOSTS = ['.supabase.co', '.supabase.in'];

/**
 * True only for sources the optimizer can actually fetch AND benefit from:
 * same-origin paths (files in /public) and Supabase Storage objects.
 *
 * Everything else is false — `blob:`/`data:` (client-only; the optimizer
 * fetches server-side and cannot read them), third-party hosts, Giphy, and
 * Supabase's own `/storage/v1/render/` transform endpoint, which is not in
 * the `remotePatterns` pathname filter.
 */
export function isOptimizableImageSrc(src: string | null | undefined): boolean {
  if (!src) return false;

  // Authenticated media proxy: the Next optimizer fetches server-side with NO
  // user cookie, so it 403s on private objects. Proxied media must render
  // unoptimized (the browser fetches directly with its session). Checked
  // before the same-origin rule below, which would otherwise mark it true.
  if (src.startsWith('/api/media/')) return false;

  // Same-origin path (e.g. /logo.png) — always optimizable, no host to check.
  if (src.startsWith('/')) return true;

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    // A src we cannot parse is by definition not a Supabase Storage URL.
    // Returning false routes it to `unoptimized`, which renders it as-is
    // rather than handing Next a source it would throw on. Deliberate.
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (!SUPABASE_HOSTS.some((suffix) => url.hostname.endsWith(suffix))) return false;

  return url.pathname.startsWith(SUPABASE_OBJECT_PREFIX);
}
