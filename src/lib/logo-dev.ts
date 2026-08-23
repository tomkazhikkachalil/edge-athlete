/**
 * Logo.dev wiring — brand marks for the equipment picker.
 *
 * Logo.dev is the successor Clearbit points to after its own Logo API shut
 * down in December 2025 (which is what left 66 broken brand logos here).
 *
 * The token is a PUBLISHABLE key: it is designed for client-side use and ends
 * up inlined in the JS bundle either way, so it is not a secret. It is still
 * an env var so the feature can be turned off without a code change.
 *
 * ⚠️ NEXT_PUBLIC_* is inlined AT BUILD TIME. Setting the token in Vercel has
 * no effect until the next deploy.
 *
 * Unset token → no logos, no requests, initial-letter tiles. That is a
 * supported state, not a degraded one; see BrandLogo.
 */

const TOKEN = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

/**
 * Whether logos are configured. Also gates the attribution link — crediting a
 * service we are not actually using would be worse than not crediting it.
 */
export const LOGO_DEV_ENABLED = Boolean(TOKEN);

/**
 * Logo URL for a brand domain, or null when the feature is off or the brand
 * has no domain (plenty of seed brands don't — they fall back to a letter).
 *
 * `size` is the RENDERED edge in px; the request asks for 2× for retina.
 */
export function logoUrl(domain: string | undefined, size: number): string | null {
  if (!TOKEN || !domain) return null;
  const params = new URLSearchParams({
    token: TOKEN,
    size: String(size * 2),
    format: 'png',
    retina: 'true',
  });
  return `https://img.logo.dev/${encodeURIComponent(domain)}?${params.toString()}`;
}

/**
 * A website URL/string → the bare domain `logoUrl` wants, or null when
 * nothing domain-shaped is in there. Handles missing schemes,
 * protocol-relative `//host` inputs, `www.` prefixes, ports, and paths —
 * golf-course `website` values are provider free text, so be forgiving on
 * input and strict on output (must contain a dot, no spaces).
 */
export function websiteDomain(website: string | null | undefined): string | null {
  const raw = website?.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : raw.startsWith('//')
      ? `https:${raw}`
      : `https://${raw}`;
  try {
    const host = new URL(withScheme).hostname.replace(/^www\./i, '').toLowerCase();
    return host.includes('.') && !host.includes(' ') ? host : null;
  } catch {
    return null;
  }
}
