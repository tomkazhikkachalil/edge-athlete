'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { isScoutAccount } from '@/lib/recruiting/scout-access';

// ── /app/scout — the scout's home (Recruiting skeleton R2) ────────────────
// The shell: R3 fills it with the shortlist, R4 with "Find athletes". Only
// a scout account lands here; anyone else gets a real screen with a way
// back (never a redirect into nowhere). Order of checks matters:
// initialAuthCheckComplete before !user.

export default function ScoutHomePage() {
  const { user, profile, loading, initialAuthCheckComplete } = useAuth();

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 py-6">{body}</main>
    </div>
  );

  if (!initialAuthCheckComplete || loading) {
    return shell(
      <div className="flex items-center justify-center py-16" aria-busy="true">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  if (!user) {
    return shell(
      <div className="bg-surface rounded-lg border border-border p-6 text-center" data-scout-gate="signed-out">
        <h1 className="text-h3 font-bold text-primary mb-2">Sign in to scout</h1>
        <p className="text-tertiary mb-4">Scouting is for signed-in scout accounts.</p>
        <Link href="/" className="px-4 py-2 bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover min-h-[44px] inline-flex items-center">
          Sign in
        </Link>
      </div>
    );
  }

  if (!isScoutAccount(profile)) {
    return shell(
      <div className="bg-surface rounded-lg border border-border p-6 text-center" data-scout-gate="not-scout">
        <h1 className="text-h3 font-bold text-primary mb-2">This area is for scout accounts</h1>
        <p className="text-tertiary mb-4">Coaches and scouts sign up with a scout account to find and follow recruitable athletes.</p>
        <Link href="/feed" className="px-4 py-2 bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover min-h-[44px] inline-flex items-center">
          Back to feed
        </Link>
      </div>
    );
  }

  return shell(
    <div className="space-y-6" data-scout-home="">
      <header className="bg-surface rounded-lg border border-border p-4 sm:p-6">
        <p className="text-xs text-muted">Scouting</p>
        <h1 className="text-xl sm:text-2xl font-bold text-primary">
          {profile?.first_name ? `${profile.first_name}'s scouting` : 'Your scouting'}
        </h1>
        {profile?.scout_affiliation && <p className="mt-1 text-sm text-secondary">{profile.scout_affiliation}</p>}
      </header>
      <section aria-label="Shortlist" className="bg-surface rounded-lg border border-border p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-primary mb-1">Shortlist</h2>
        <p className="text-sm text-tertiary">
          Athletes you shortlist from their profiles will collect here. Find recruitable athletes on{' '}
          <Link href="/explore" className="text-brand-fg hover:text-brand-fg-strong font-medium">Explore</Link>
          {' '}— open profiles show a Recruiting card.
        </p>
      </section>
    </div>
  );
}
