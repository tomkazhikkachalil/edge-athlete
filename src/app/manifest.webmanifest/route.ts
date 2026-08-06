import type { MetadataRoute } from 'next';
import { NextResponse, type NextRequest } from 'next/server';
import { THEME_RESOLVED_COOKIE } from '@/lib/theme-cookie';
import { manifestColorsFor } from '@/lib/theme-colors';

/**
 * The web app manifest, served by hand rather than through Next's
 * `app/manifest.ts` convention.
 *
 * WHY NOT THE CONVENTION: it makes Edge Athlete installable, but Next also
 * AUTO-INJECTS its own `<link rel="manifest">` whenever that file exists —
 * and that injected link cannot carry `crossorigin="use-credentials"`. A
 * manifest fetch omits cookies without it, so the themed splash below would
 * silently never happen, and we'd ship two competing link tags whose
 * precedence is left to browser order. As a route handler, the only link is
 * the one hand-rendered in layout.tsx, with credentials enabled.
 *
 * THEME-AWARE: reads `ea-theme-resolved` (written by the pre-paint theme
 * script and by useTheme) rather than the `ea-theme` prefs cookie, because a
 * server cannot resolve 'scheduled' (needs the device clock) or 'system'
 * (needs the OS appearance setting). Anything missing or unrecognised falls
 * back to the light pair — exactly the pre-adaptive output.
 *
 * KNOWN LIMIT: Chrome re-fetches the manifest periodically, so the splash
 * follows theme changes. iOS caches it at INSTALL time, so an installed
 * iPhone app keeps the theme it was installed with until it is reinstalled.
 */
export async function GET(request: NextRequest) {
  const colors = manifestColorsFor(request.cookies.get(THEME_RESOLVED_COOKIE)?.value);

  const manifest: MetadataRoute.Manifest = {
    name: 'Edge Athlete',
    short_name: 'Edge Athlete',
    description: 'Track your stats and trends, share your game, and connect with other athletes.',
    start_url: '/feed',
    display: 'standalone',
    background_color: colors.background,
    theme_color: colors.theme,
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      // Per-user by construction: a shared cache holding the dark variant
      // would hand a dark splash to light-theme installs.
      'Cache-Control': 'private, no-store',
    },
  });
}
