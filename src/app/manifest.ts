import type { MetadataRoute } from 'next';

// Web app manifest → served at /manifest.webmanifest. Makes Edge Athlete
// installable (Add to Home Screen / install prompt). No offline scope yet —
// this is the installability baseline, not a full offline PWA.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Edge Athlete',
    short_name: 'Edge Athlete',
    description: 'Log rounds, track your stats and trends, and connect with other golfers.',
    start_url: '/feed',
    display: 'standalone',
    background_color: '#eff6ff',
    theme_color: '#2563eb',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
