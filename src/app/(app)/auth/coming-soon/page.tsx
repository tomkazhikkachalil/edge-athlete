import type { Metadata } from 'next';
import ComingSoon from '@/components/ComingSoon';

// ── /auth/coming-soon — the launch gate's page (Sep 30 2026) ───────────────
// Every signed-out visitor lands here while NEXT_PUBLIC_LAUNCH_GATE=1 (the middleware).
// Under /auth so it needs no new root segment (no reserved-handle
// migration). Never a dead end: the sign-in link is the way in for an
// existing account; the waitlist is the way to be told when it opens.

export const metadata: Metadata = {
  title: 'Edge Athlete — coming soon',
  robots: { index: false, follow: false },
};

export default function ComingSoonPage() {
  return <ComingSoon />;
}
