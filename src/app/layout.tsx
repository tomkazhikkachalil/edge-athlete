import type { Metadata, Viewport } from "next";
import { Inter } from 'next/font/google';
import { AuthProvider } from "@/lib/auth";
import { NotificationsProvider } from "@/lib/notifications";
import { MessagesProvider } from "@/lib/messages";
import { GlobalToasts } from "@/components/Toast";
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
