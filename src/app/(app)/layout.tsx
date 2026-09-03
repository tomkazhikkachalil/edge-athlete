import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter } from 'next/font/google';
import { AuthProvider } from "@/lib/auth";
import { NotificationsProvider } from "@/lib/notifications";
import { MessagesProvider } from "@/lib/messages";
import { GlobalToasts } from "@/components/Toast";
import ActingAsBanner from "@/components/ActingAsBanner";
import TransferBanner from "@/components/TransferBanner";
import DeletionScheduledBanner from "@/components/DeletionScheduledBanner";
import ChatDock from "@/components/chat-dock/ChatDock";
import ThemeApplier from "@/components/ThemeApplier";
import { THEME_INIT_SCRIPT } from "@/lib/theme-script";
import { FLOOR_POLYFILLS_SCRIPT } from "@/lib/floor-polyfills";
import { THEME_COLOR } from "@/lib/theme-colors";
import "../globals.css";
import "@fortawesome/fontawesome-free/css/all.min.css";

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter'
});

export const metadata: Metadata = {
  title: "Edge Athlete",
  description: "Connect athletes, clubs, leagues, and fans",
  // Absolute base for og/twitter image URLs. Swap NEXT_PUBLIC_APP_URL in
  // Vercel when the custom domain (edgeathlete.ca) goes live.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app'),
  openGraph: {
    title: 'Edge Athlete',
    description: 'Connect athletes, clubs, leagues, and fans',
    siteName: 'Edge Athlete',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Edge Athlete' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og-image.png'],
  },
  // NOTE: `manifest` is deliberately NOT declared here. The manifest is
  // theme-aware (app/manifest.ts reads the ea-theme-resolved cookie), and a
  // manifest fetch omits credentials unless the link carries
  // crossorigin="use-credentials" — which the metadata API cannot express.
  // The link is hand-rendered in <head> below. Re-adding it here would emit a
  // SECOND, credential-less manifest link and quietly break the themed splash.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Edge Athlete",
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  // Resize the layout viewport when the software keyboard opens (Android/
  // Chromium; iOS Safari ignores this — handled via visualViewport instead).
  interactiveWidget: 'resizes-content',
  // Mobile browser chrome / status bar tint. These media variants are only
  // the SSR default — browsers evaluate them against the OS, not our
  // data-theme, so the theme script and useTheme overwrite BOTH metas with
  // the resolved colour (see src/lib/theme-colors.ts). Without that, a dark
  // app on a light-OS phone kept a violet bar above dark content.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-request CSP nonce minted by the middleware (hardening round). Reading
  // headers() makes the root layout — and with it every page — DYNAMIC; the
  // deliberate trade for an enforced script-src (every document request
  // already transits the middleware's auth call, so nothing was truly
  // edge-cached before). Null on any path the middleware matcher skips.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // suppressHydrationWarning is attribute-scoped to <html> only: the theme
    // script below stamps data-theme before React hydrates, and that delta
    // is expected, not a bug.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* BLOCKING on purpose — resolves the stored theme (including the
            schedule and any override) and stamps <html> before first paint,
            so there is no flash of the wrong theme. Must stay ahead of any
            stylesheet-dependent paint; see src/lib/theme-script.ts. */}
        {/* Also blocking, and FIRST: installs the globals the iOS 15 floor lacks
            but Next's own client runtime calls bare (structuredClone). Must run
            before any chunk; see src/lib/floor-polyfills.ts. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: FLOOR_POLYFILLS_SCRIPT }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* use-credentials is load-bearing: without it the browser fetches the
            manifest without cookies, app/manifest.ts never sees the resolved
            theme, and every install gets the light splash. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body className={`${inter.className} antialiased`}>
        <AuthProvider>
          <ThemeApplier />
          <NotificationsProvider>
            <MessagesProvider>
              <ActingAsBanner />
              <TransferBanner />
              <DeletionScheduledBanner />
              {children}
              {/* Persistent chat dock (big screens; flag-gated internally).
                  Root-level = survives every client navigation untouched. */}
              <ChatDock />
              {/* One app-wide toast surface — every component's useToast()
                  renders here (per-page containers are gone) */}
              <GlobalToasts />
            </MessagesProvider>
          </NotificationsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
