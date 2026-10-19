import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Inter } from 'next/font/google';
import { THEME_INIT_SCRIPT } from '@/lib/theme-script';
import { THEME_COLOR } from '@/lib/theme-colors';
import '../globals.css';
import '@fortawesome/fontawesome-free/css/all.min.css';

// ── The ADMIN root layout (flow changes program, item 2 — Oct 19 2026) ──────
// A third root layout via route groups: the console is its own door with
// its own cookie (src/lib/admin/session.ts), so nothing from the app shell
// belongs here — no AuthProvider, no notifications or messages, no tab bar,
// no install or push hosts, no chat dock. What IS here: the fonts, the
// global styles, the theme script with the request nonce (this tree is
// dynamic — the middleware's default branch mints the nonce), the icon
// sheet the console's panels use, and `noindex` on every page.

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: { default: 'Edge Athlete admin', template: '%s · Edge Athlete admin' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
  ],
};

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.className} bg-canvas text-primary antialiased`}>{children}</body>
    </html>
  );
}
