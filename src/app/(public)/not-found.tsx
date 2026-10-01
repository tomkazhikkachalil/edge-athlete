// ── The (public) group's 404 (phase 6 R1) ───────────────────────────────────
// Load-bearing: the root [slug] vanity segment makes EVERY unknown root
// path resolve inside the (public) group, so its notFound() no longer
// reaches src/app/(app)/not-found.tsx. Without this file Next renders its
// bare default 404 under the (public) root layout — a dead end, which the
// navigation charter forbids. Renders under src/app/(public)/layout.tsx:
// server-only, light-only, no auth concept — the two links are the
// anonymous-safe escapes.

import Link from 'next/link';

export default function PublicNotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <div className="max-w-md w-full text-center py-16">
        <p className="text-6xl font-bold text-gray-300 dark:text-stone-700 mb-4">404</p>
        <h1 className="text-2xl font-bold text-primary mb-2">Page not found</h1>
        <p className="text-tertiary mb-8">
          There’s nothing at this address — the organization may have moved
          or the link may be mistyped.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="min-h-[44px] inline-flex items-center px-5 rounded-lg bg-brand text-white font-semibold hover:bg-brand-hover transition-colors"
          >
            Go home
          </Link>
          <Link
            href="/sports/explore"
            className="min-h-[44px] inline-flex items-center px-5 rounded-lg border border-border-strong text-secondary font-medium hover:bg-gray-100 dark:hover:bg-stone-800 transition-colors"
          >
            Explore athletes
          </Link>
        </div>
      </div>
    </main>
  );
}
