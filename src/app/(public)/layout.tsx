import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import '../globals.css';
import { PUBLIC_THEME_SCRIPT } from '@/lib/theme-script';

// ── The PUBLIC root layout (phase 3 R1) — the spike verdict made real ───────
// A second root layout via route groups: this <html> never reads
// headers(), so documents under (public)/ can be prerendered/ISR and
// CDN-cached — the one thing the app root layout structurally cannot do
// (its CSP-nonce headers() read keeps every page dynamic; DEVLOG Sep 1).
//
// Deliberately ABSENT vs the (app) root layout, each load-bearing:
//   * headers()/nonce + ThemeApplier + the app's THEME_INIT_SCRIPT — the
//     server render here is viewer-independent: no cookie is READ on the
//     server, no Vary, one cached document for everyone.
//     LIGHT AND DARK (Oct 1 2026 — light-only until then): the visitor's
//     theme is applied on THEIR device by PUBLIC_THEME_SCRIPT below — the
//     read-only variant of the app's head script (the same `ea-theme`
//     cookie, then the same mirror, else the default schedule; it writes
//     nothing). A site fixed to Always light / Always dark carries
//     data-theme on its own root instead (themeAttrs) and ignores the
//     visitor. The static CSP allows an inline script; no nonce is needed.
//   * AuthProvider/Notifications/Messages/ChatDock/banners — no session
//     concept exists here; nothing may branch on a viewer.
//   * The manifest link — the PWA belongs to the app shell.
//   * Font Awesome — public modules use inline SVG/lucide only; keeping
//     the FA sheet out saves ~70KB of css on every crawled page.
// A SINGLE themeColor (not the light/dark media pair): the browser would
// match a media pair against the OS, which is not what decides the theme
// here. The head script darkens it when the page resolves dark.
//
// CSP for this tree comes from the middleware's /org/ static branch
// (buildStaticCsp — no nonce needed since nothing here is dynamic).

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app'),
  title: {
    default: 'Edge Athlete',
    template: '%s · Edge Athlete',
  },
  description: 'Team sites, schedules, and standings on Edge Athlete.',
  // R4: share-card defaults mirroring the (app) root layout; per-page
  // generateMetadata overrides title/description/url, and the
  // opengraph-image convention file overrides the image per org.
  openGraph: {
    siteName: 'Edge Athlete',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Edge Athlete' }],
  },
  // twitter.images deliberately unset — Twitter falls back to og:image,
  // which is the per-org card on every org page.
  twitter: {
    card: 'summary_large_image',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

export default function PublicRootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is attribute-scoped to <html>: the script
    // below stamps data-theme before React hydrates, and that delta is
    // expected (the app root layout's own note).
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* BLOCKING on purpose — stamps the visitor's theme before first
            paint. Read-only: see src/lib/theme-script.ts. */}
        <script dangerouslySetInnerHTML={{ __html: PUBLIC_THEME_SCRIPT }} />
      </head>
      <body className={`${inter.className} bg-canvas text-primary antialiased`}>{children}</body>
    </html>
  );
}
