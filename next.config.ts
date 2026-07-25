import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Image optimization configuration
  images: {
    // Allow images from Supabase Storage and common image sources
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/**',
      },
      {
        protocol: 'https',
        hostname: '**.supabase.in',
        pathname: '/storage/v1/object/**',
      },
      {
        protocol: 'https',
        hostname: '**.giphy.com',
      },
    ],
    // Optimize for various device sizes
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // Supported formats (WebP and AVIF for modern browsers)
    formats: ['image/webp', 'image/avif'],
    // Cache optimized images for 1 year (31536000 seconds)
    minimumCacheTTL: 31536000,
    // Disable image optimization for external URLs that don't support it
    unoptimized: false,
  },
};

// Sentry build plugin: source-map upload only runs when SENTRY_AUTH_TOKEN
// is configured (Vercel); without it the build behaves exactly as before —
// no warnings, no uploads. Runtime error capture works either way.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
