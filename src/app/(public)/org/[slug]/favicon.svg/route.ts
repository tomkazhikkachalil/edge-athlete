import { getCachedSite } from '@/lib/org-sites/cached';
import { parseThemeTokens, resolveAccentPair } from '@/lib/org-sites/validate';

// ── /org/[slug]/favicon.svg — the generated per-site favicon (phase 6b B1)
// A hand-written SVG (no next/og outside card.png — the B4 guardrail):
// a rounded square in the site's accent with the brand's initial. Sites
// with an uploaded logo advertise the logo streamer instead (layout
// generateMetadata); this route still answers for them. Draft ⇔ missing.
// The middleware matcher skips *.svg, so this never pays the auth trip.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) return new Response('Not Found', { status: 404 });

  const tokens = parseThemeTokens(site.theme_token_set);
  const { accent, strong } = resolveAccentPair(tokens);
  const source = (tokens.wordmark ?? site.orgName).trim();
  // One safe glyph: a letter or digit, else the platform's E. User text
  // never reaches the markup unescaped.
  const initial = /^[A-Za-z0-9]/.test(source) ? source[0].toUpperCase() : 'E';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${strong}"/>` +
    `</linearGradient></defs>` +
    `<rect width="64" height="64" rx="14" fill="url(#g)"/>` +
    `<text x="32" y="44" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" ` +
    `font-size="36" font-weight="700" fill="#ffffff">${initial}</text>` +
    `</svg>`;

  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
