'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

// Shared brand bar for logged-out / standalone pages (login, signup,
// onboarding, password flows, guardian flows, contact, legal). The logo
// stays non-interactive by design — these pages should not navigate away
// via an accidental logo tap mid-flow. The right-aligned escape link is
// the guaranteed exit instead: every standalone screen offers a way back
// to the feed (signed in) or the sign-in page (signed out). Pages with a
// genuinely modal step (e.g. a transfer mid-execution) opt out via
// hideEscape; the link also hides on "/" itself (it IS the sign-in page)
// and while the auth state is still resolving (no flash of the wrong
// destination).
export default function BrandBar({ hideEscape = false }: { hideEscape?: boolean }) {
  const pathname = usePathname();
  const { user, initialAuthCheckComplete } = useAuth();

  const showEscape = !hideEscape && pathname !== '/' && initialAuthCheckComplete;

  return (
    <div className="relative w-full bg-white border-b border-violet-100 py-3 px-4 flex justify-center">
      <h1 className="sr-only">Edge Athlete</h1>
      <Image
        src="/logo.png"
        alt="Edge Athlete"
        width={180}
        height={45}
        preload
        className="h-8 sm:h-9 w-auto"
      />
      {showEscape && (
        <Link
          href={user ? '/feed' : '/'}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-violet-600 hover:text-violet-700 hover:underline"
        >
          {user ? (
            <>
              <span className="hidden sm:inline">Back to my account</span>
              <span className="sm:hidden">My account</span>
            </>
          ) : (
            <>
              <span className="hidden sm:inline">Back to sign in</span>
              <span className="sm:hidden">Sign in</span>
            </>
          )}
        </Link>
      )}
    </div>
  );
}
