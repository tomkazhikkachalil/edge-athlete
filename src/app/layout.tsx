import type { Metadata, Viewport } from "next";
import { Inter } from 'next/font/google';
import { AuthProvider } from "@/lib/auth";
import { NotificationsProvider } from "@/lib/notifications";
import { MessagesProvider } from "@/lib/messages";
import { GlobalToasts } from "@/components/Toast";
import ActingAsBanner from "@/components/ActingAsBanner";
import TransferBanner from "@/components/TransferBanner";
import "./globals.css";
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
  // Next serves the manifest from app/manifest.ts at /manifest.webmanifest
  manifest: "/manifest.webmanifest",
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
  // Match the manifest theme so the mobile browser chrome / status bar
  // tints to the app's brand purple when installed.
  themeColor: '#7c3aed',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={`${inter.className} antialiased`}>
        <AuthProvider>
          <NotificationsProvider>
            <MessagesProvider>
              <ActingAsBanner />
              <TransferBanner />
              {children}
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
