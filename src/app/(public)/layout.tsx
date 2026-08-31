import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import '../globals.css';

// ── The PUBLIC root layout (phase 3 R1) — the spike verdict made real ───────
// A second root layout via route groups: this <html> never reads
// headers(), so documents under (public)/ can be prerendered/ISR and
// CDN-cached — the one thing the app root layout structurally cannot do
// (its CSP-nonce headers() read keeps every page dynamic; DEVLOG Sep 1).
//
// Deliberately ABSENT vs the (app) root layout, each load-bearing:
//   * headers()/nonce + THEME_INIT_SCRIPT + ThemeApplier — public pages
//     are LIGHT-ONLY: dark: utilities key off the data-theme ATTRIBUTE,
//     which this tree never stamps, so they are inert. No script, no
//     cookie, no Vary.
//   * AuthProvider/Notifications/Messages/ChatDock/banners — no session
//     concept exists here; nothing may branch on a viewer.
//   * The manifest link — the PWA belongs to the app shell.
//   * Font Awesome — public modules use inline SVG/lucide only; keeping
//     the FA sheet out saves ~70KB of css on every crawled page.
// A SINGLE themeColor (not the light/dark media pair) so dark-OS phones
// don't tint the chrome dark over light-only content.
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
    <html lang="en" className={inter.variable}>
      <body className={`${inter.className} bg-canvas text-primary antialiased`}>{children}</body>
    </html>
  );
}
