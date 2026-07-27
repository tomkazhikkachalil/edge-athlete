import type { MetadataRoute } from 'next';

// Web app manifest → served at /manifest.webmanifest. Makes Edge Athlete
// installable (Add to Home Screen / install prompt). No offline scope yet —
// this is the installability baseline, not a full offline PWA.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Edge Athlete',
    short_name: 'Edge Athlete',
    description: 'Track your stats and trends, share your game, and connect with other athletes.',
    start_url: '/feed',
    display: 'standalone',
    background_color: '#f5f3ff',
    theme_color: '#7c3aed',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
