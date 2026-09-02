import { createElement } from 'react';
import { ImageResponse } from 'next/og';
import { getCachedSite } from '@/lib/org-sites/cached';
import { parseThemeTokens, resolveAccentPair } from '@/lib/org-sites/validate';

// ── /org/[slug]/card.png — the per-org share card (phase 3 R4) ─────────────
// An EXPLICIT route instead of the opengraph-image convention file: under
// the (public) route group the convention file serves at a HASH-SUFFIXED
// path that only the meta tag knows, which makes probes and share
// debugging indirect. An explicit route referenced from each page's
// openGraph.images is deterministic, hash-free, and probe-able.
// Lives under /org/ ON PURPOSE (vercel.json no-stores /api/*): it rides
// the middleware static-CSP branch and keeps its own Cache-Control.
// A dot-segment can never be shadowed by a page slug (slugs can't
// contain dots). next/og is imported ONLY here — its wasm payload stays
// isolated to this route bundle; createElement instead of JSX because
// route handlers are .ts. Bundled Geist regular only: hierarchy via
// size/color, never fontWeight.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) {
    // Draft ⇔ missing (the publish gate) — no card either way.
    return new Response('Not Found', { status: 404 });
  }

  // B1: the explicit strong token wins over the derived companion.
  const { accent, strong: accentStrong } = resolveAccentPair(parseThemeTokens(site.theme_token_set));

  const card = createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundImage: `linear-gradient(to bottom right, ${accent}, ${accentStrong})`,
        color: '#ffffff',
        padding: 80,
      },
    },
    createElement(
      'div',
      {
        style: {
          fontSize: 76,
          textAlign: 'center',
          lineHeight: 1.15,
          maxWidth: 1000,
          display: 'flex',
        },
      },
      site.orgName
    ),
    createElement(
      'div',
      {
        style: {
          marginTop: 28,
          fontSize: 30,
          color: 'rgba(255,255,255,0.85)',
          display: 'flex',
        },
      },
      'Schedules, standings, and teams — on Edge Athlete'
    )
  );

  return new ImageResponse(card, {
    width: 1200,
    height: 630,
    headers: {
      // Replaces ImageResponse's 1-year immutable default — a rename or
      // re-accent must reach shares within the hour.
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
