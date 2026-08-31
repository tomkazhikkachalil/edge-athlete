import Link from 'next/link';
import BrandBar from '@/components/BrandBar';

// Global 404. BrandBar's auth-aware escape link gives signed-in visitors
// a direct path to /feed; the primary CTA goes to "/", which routes
// signed-in users onward and shows sign-in to everyone else.
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <BrandBar />
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-surface rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-violet-100 dark:bg-violet-950/60 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-2xl font-bold text-brand-fg" aria-hidden="true">404</span>
          </div>
          <h1 className="text-2xl font-bold text-primary mb-2">Page not found</h1>
          <p className="text-tertiary mb-6">
            That page doesn&apos;t exist or may have moved.
          </p>
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover transition-colors"
          >
            Take me home
          </Link>
        </div>
      </div>
    </div>
  );
}
