import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // The media worker (video posters PR 7, Oct 13 2026): ffmpeg-static is a
  // platform BINARY — kept out of the bundler and traced into the two routes
  // that run it (and nowhere else: the function that carries it is ~80 MB).
  serverExternalPackages: ['ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/cron/media-jobs': ['./node_modules/ffmpeg-static/ffmpeg', './node_modules/sharp/**', './node_modules/@img/**'],
    '/api/admin/media-jobs': ['./node_modules/ffmpeg-static/ffmpeg', './node_modules/sharp/**', './node_modules/@img/**'],
    // The org card renderers crop the hero with sharp (the vanity twin
    // re-exports the org route's GET) — the ONLY other users of the library.
    // The keys are picomatch globs against the normalized app path, so the
    // dynamic segment's brackets are escaped (a bare `[slug]` is a character
    // class and matches nothing here).
    '/org/\\[slug\\]/card.png': ['./node_modules/sharp/**', './node_modules/@img/**'],
    '/\\[slug\\]/card.png': ['./node_modules/sharp/**', './node_modules/@img/**'],
  },
  // The function diet (performance program, Nov 7 2026). The tracer followed
  // a dynamic `./ffmpeg-bin` import and a `readFile(join(dir, `${id}.png`))`
  // it could not resolve, so EVERY function that merely enqueued a media job
  // carried the 45 MB binary, sharp's 28 MB and every *.png in the project —
  // 95 MB of Sep 30 snapshot photos among them (~170 MB per function, a
  // 1.5–1.8 s cold start on the feed's own API). Nothing under these paths is
  // read by a function at runtime: the binary is traced into the two worker
  // routes above, sharp into the worker and the two org-card renderers above, and no route
  // reads the repo's docs, tests, snapshots or public PNGs from disk (public/
  // is served by the CDN). `scripts/check-function-weight.mjs` (in `npm run
  // verify`) fails the build if a route grows past 25 MB again.
  outputFileTracingExcludes: {
    '*': [
      './database/**',
      './docs/**',
      './e2e/**',
      './public/**',
      './scripts/**',
      './node_modules/ffmpeg-static/**',
      './node_modules/sharp/**',
      './node_modules/@img/**',
    ],
  },
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
  // Browser errors go through OUR origin (every-browser round, Oct 16 2026):
  // Brave Shields — and every blocker on EasyPrivacy — drop direct posts to
  // *.ingest.sentry.io, so a Brave user's errors never reached us. The plugin
  // rewrites this path to Sentry's ingest for our DSN only. Under /api, so the
  // middleware (matcher excludes api) never gates or slows it; the name is
  // proven unblocked by `npm run check:blocklists` (Sentry's suggested
  // `/monitoring` is itself on the lists).
  tunnelRoute: '/api/relay',
});
