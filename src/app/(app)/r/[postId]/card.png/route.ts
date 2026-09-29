import { createElement, type ReactElement } from 'react';
import { ImageResponse } from 'next/og';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { shareDate } from '@/lib/play/share-card';
import { readShareCard } from '@/lib/play/share-server';

// ── /r/[postId]/card.png — a result's share image (the Play program, 244) ──
// The org card's recipe (src/app/(public)/org/[slug]/card.png): an EXPLICIT
// route (hash-free, probe-able) that the page's openGraph.images names;
// next/og imported ONLY in a card.png route (guardrail 5); createElement
// because a route handler is .ts; the bundled Geist regular only, so the
// hierarchy is size and colour, never fontWeight. The middleware matcher
// skips *.png, so no session is ever read — the image is the same for
// everyone (share-server.ts is viewer-independent) and CDN-cached for an
// hour. Anything without a public card is a 404: the image never confirms
// a private result exists.

const BRAND_FROM = '#6d28d9';
const BRAND_TO = '#8b5cf6';

const div = (style: Record<string, unknown>, ...children: Array<ReactElement | string | null>) =>
  createElement('div', { style: { display: 'flex', ...style } }, ...children.filter(c => c !== null));

export async function GET(_request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const result = await readShareCard(getSupabaseAdmin(), postId);
  if (!result || !('card' in result)) return new Response('Not Found', { status: 404 });
  const { card } = result;

  const chips = card.chips.map(chip =>
    div(
      { flexDirection: 'column', alignItems: 'flex-start', marginRight: 56 },
      div({ fontSize: 52, color: '#ffffff' }, chip.value),
      div({ fontSize: 26, color: 'rgba(255,255,255,0.75)' }, chip.label)
    )
  );

  const image = div(
    {
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: 72,
      color: '#ffffff',
      backgroundImage: `linear-gradient(to bottom right, ${BRAND_FROM}, ${BRAND_TO})`,
    },
    div(
      { flexDirection: 'column' },
      div({ fontSize: 28, color: 'rgba(255,255,255,0.8)', letterSpacing: 2 }, card.sportName.toUpperCase()),
      div({ fontSize: 60, lineHeight: 1.1, marginTop: 8, maxWidth: 1056 }, card.athleteName),
      card.subline ? div({ fontSize: 30, color: 'rgba(255,255,255,0.9)', marginTop: 8, maxWidth: 1056 }, card.subline) : null
    ),
    div(
      { alignItems: 'flex-end' },
      div({ fontSize: 168, lineHeight: 1 }, card.hero.value),
      div({ fontSize: 40, marginLeft: 24, marginBottom: 18, color: 'rgba(255,255,255,0.9)' }, card.hero.label)
    ),
    div(
      { justifyContent: 'space-between', alignItems: 'flex-end' },
      div({}, ...chips),
      div(
        { flexDirection: 'column', alignItems: 'flex-end' },
        div({ fontSize: 26, color: 'rgba(255,255,255,0.8)' }, `${shareDate(card.date)}${card.verified ? ' · Verified' : ''}`),
        div({ fontSize: 30, marginTop: 6 }, 'Edge Athlete')
      )
    )
  );

  return new ImageResponse(image, {
    width: 1200,
    height: 630,
    headers: {
      // The org card's rule: an edit (a corrected score) reaches shares within the hour.
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
