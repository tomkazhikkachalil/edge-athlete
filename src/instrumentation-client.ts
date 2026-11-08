// Sentry — browser side. Since the browser boot diet (performance program
// Phase 3b, Nov 2026) NOTHING of the SDK loads here: two tiny handlers
// buffer errors until the SDK is imported on the first one
// (src/lib/observability/sentry-browser.ts), and the config (sentry-env.ts)
// is applied then. Tracing and sessions are off (Phase 2d), so the router
// transition hook has nothing to measure and is a no-op export. Inert
// without NEXT_PUBLIC_SENTRY_DSN, exactly as before.
import { installBrowserErrorHandlers } from '@/lib/observability/sentry-browser';

installBrowserErrorHandlers();

export function onRouterTransitionStart(): void {
  /* no tracing — nothing to start */
}
