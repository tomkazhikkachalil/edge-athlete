import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // The build id the service worker's URL carries (src/lib/sw/static-cache.ts):
  // the deploy's commit on Vercel, 'local' elsewhere.
  env: {
    NEXT_PUBLIC_BUILD_ID: (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 12),
  },
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
    // LOAD-BEARING, not decorative: Next 16 dropped 16 from the DEFAULT
    // imageSizes. This explicit array is the only thing preserving it.
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // Supported formats (WebP and AVIF for modern browsers)
    formats: ['image/webp', 'image/avif'],
    // Next 16 narrowed the DEFAULT qualities from "anything" to [75], and
    // coerces unlisted values to the nearest listed one SILENTLY — no error,
    // no warning, just a quieter image. These three are exactly what this
    // codebase asks for today (75 from a bare <Image>, 85 from
    // OptimizedImage/AvatarImage, 90 from MediaImage), so declaring them keeps
    // output identical. Removing a value here is a visual change.
    qualities: [75, 85, 90],
    // Speed round 2 (Oct 4 2026): ONE DAY, down from a year. Public post
    // media now goes through the optimizer (`/api/media/o/…`), and a post
    // that flips private must leave the optimizer's cache within the window
    // the CDN already granted its bytes (s-maxage=86400). Avatars and logos
    // re-transform daily — negligible. (Next 16's default is 4 h; this is
    // still explicit on purpose.)
    minimumCacheTTL: 86400,
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
