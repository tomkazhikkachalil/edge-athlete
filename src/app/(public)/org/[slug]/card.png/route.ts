import { createElement } from 'react';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { getCachedSite } from '@/lib/org-sites/cached';
import { parseHeroConfig, parseThemeTokens, resolveAccentPair } from '@/lib/org-sites/validate';

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
//
// N2 (program 10): the card draws the site's HERO PHOTO when it has one
// (the S1 hero_config imagePath — a site asset in the private uploads
// bucket) with a dark gradient over it and the name at the foot; the org
// LOGO rides along as a tile. The bytes are fetched from the Supabase
// origin through a 60s signed URL (the org-media streamer's own recipe —
// a same-origin fetch inside OG generation was the thing refused before)
// and CROPPED TO THE SLOT with sharp (cover-fit, centred, re-encoded as
// png — Satori's objectFit:cover left a bare strip on a 4:3 photo, and
// sharp also turns a webp/gif hero into something Satori draws), then
// handed over as an ArrayBuffer. Every guard (3s abort, ≤4MB, an image
// content-type, a decodable file) falls back to the gradient card, so
// the card can never fail because of a photo. The 1h s-maxage stays: a
// hero change reaches shares within the hour, as a rename does.

const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_FETCH_MS = 3000;
const DRAWABLE_TYPE_RE = /^image\/(png|jpeg|webp|gif)(;|$)/;
const DRAWABLE_PATH_RE = /\.(png|jpe?g|webp|gif)$/i;

/** A stored image, cover-cropped to w×h as PNG bytes for Satori, or null
 *  on ANY miss (never throws). */
async function loadImageBytes(
  key: string | null | undefined,
  w: number,
  h: number
): Promise<ArrayBuffer | null> {
  if (!key || !DRAWABLE_PATH_RE.test(key)) return null;
  try {
    const { data } = await getSupabaseAdmin().storage.from('uploads').createSignedUrl(key, 60);
    if (!data?.signedUrl) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IMAGE_FETCH_MS);
    try {
      const res = await fetch(data.signedUrl, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) return null;
      if (!DRAWABLE_TYPE_RE.test(res.headers.get('content-type') ?? '')) return null;
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > IMAGE_MAX_BYTES) return null;
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_MAX_BYTES) return null;
      const cropped = await sharp(Buffer.from(bytes), { animated: false })
        // Apply EXIF orientation BEFORE the cover crop: sharp does not auto-orient,
        // and org site assets are uploaded raw (no client-side strip), so a phone-shot
        // hero still carries its Orientation tag. Without this the crop runs on the
        // sideways axis and the card ships rotated.
        .rotate()
        .resize(w, h, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer();
      return cropped.buffer.slice(cropped.byteOffset, cropped.byteOffset + cropped.byteLength) as ArrayBuffer;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

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
  const hero = parseHeroConfig(site.hero_config);
  const [photo, logo] = await Promise.all([
    loadImageBytes(hero.imagePath, 1200, 630),
    loadImageBytes(site.logo_path, 120, 120),
  ]);

  const logoTile =
    logo &&
    createElement('img', {
      // Satori accepts an ArrayBuffer src; the type is the img element's
      // string-only src in React's eyes.
      src: logo as unknown as string,
      width: 120,
      height: 120,
      style: { width: 120, height: 120, borderRadius: 24, marginBottom: 24 },
    });
  const strap = createElement(
    'div',
    { style: { marginTop: 28, fontSize: 30, color: 'rgba(255,255,255,0.85)', display: 'flex' } },
    'Schedules, standings, and teams — on Edge Athlete'
  );

  const card = photo
    ? // The hero photo fills the card; a dark foot gradient carries the name.
      createElement(
        'div',
        { style: { width: '100%', height: '100%', display: 'flex', position: 'relative', color: '#ffffff' } },
        createElement('img', {
          src: photo as unknown as string,
          width: 1200,
          height: 630,
          style: { position: 'absolute', top: 0, left: 0, width: 1200, height: 630 },
        }),
        createElement('div', {
          style: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.05) 100%)',
          },
        }),
        createElement(
          'div',
          {
            style: {
              position: 'absolute',
              left: 0,
              bottom: 0,
              width: 1200,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              padding: 64,
            },
          },
          logoTile,
          createElement(
            'div',
            { style: { fontSize: 72, lineHeight: 1.1, maxWidth: 1072, display: 'flex' } },
            site.orgName
          ),
          strap
        )
      )
    : createElement(
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
        logoTile,
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
        strap
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
