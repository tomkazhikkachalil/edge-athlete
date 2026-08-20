import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';

const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';
const LIMIT = 20;

interface GiphyGif {
  id: string;
  images: {
    fixed_height: { url: string; width: string; height: string };
    fixed_height_still: { url: string };
    original: { url: string };
  };
}

// ── GET /api/gifs/search?q=<query>&offset=<n> ─────────────────────────────────
// Proxies Giphy search (or trending when q is empty).
// Returns: { gifs: [{ id, url, preview_url }] }
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    // Giphy is a paid third-party quota — don't let one account drain it.
    const limited = await enforceRateLimit(request, 'gif-search', { userId: user.id });
    if (limited) return limited;

    const apiKey = process.env.GIPHY_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GIF service not configured' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || '';
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const endpoint = q ? `${GIPHY_BASE}/search` : `${GIPHY_BASE}/trending`;
    const params = new URLSearchParams({
      api_key: apiKey,
      limit: String(LIMIT),
      offset: String(offset),
      rating: 'g',
      lang: 'en',
    });
    if (q) params.set('q', q);

    const res = await fetch(`${endpoint}?${params.toString()}`, {
      next: { revalidate: 60 }, // cache for 60s
    });

    if (!res.ok) {
      console.error('Giphy API error:', res.status, await res.text());
      return NextResponse.json({ error: 'Failed to fetch GIFs' }, { status: 502 });
    }

    const data = await res.json();
    const gifs = (data.data as GiphyGif[]).map((g) => ({
      id: g.id,
      url: g.images.original.url,
      // Animated grid preview (200px). fixed_height_still exists but a frozen
      // grid reads as broken next to every other GIF picker.
      preview_url: g.images.fixed_height.url,
      width: parseInt(g.images.fixed_height.width, 10) || 200,
      height: parseInt(g.images.fixed_height.height, 10) || 150,
    }));

    return NextResponse.json({ gifs });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/gifs/search error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
