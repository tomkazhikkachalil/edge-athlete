'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { isScoutAccount } from '@/lib/recruiting/scout-access';
import ScoutSearch from '@/components/recruiting/ScoutSearch';

// ── /app/scout/search — "Find athletes" (Recruiting skeleton R4) ──────────
// Scout accounts only (the same gate as the home); everyone else gets a
// real screen with a way back.

export default function ScoutSearchPage() {
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
  if (!user || !isScoutAccount(profile)) {
    return shell(
      <div className="bg-surface rounded-lg border border-border p-6 text-center" data-scout-gate={user ? 'not-scout' : 'signed-out'}>
        <h1 className="text-h3 font-bold text-primary mb-2">This area is for scout accounts</h1>
        <p className="text-tertiary mb-4">Coaches and scouts sign up with a scout account to find recruitable athletes.</p>
        <Link href={user ? '/feed' : '/'} className="px-4 py-2 bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover min-h-[44px] inline-flex items-center">
          {user ? 'Back to feed' : 'Sign in'}
        </Link>
      </div>
    );
  }

  return shell(
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs text-muted">Scouting</p>
          <h1 className="text-xl sm:text-2xl font-bold text-primary">Find athletes</h1>
        </div>
        <Link href="/app/scout" className="text-sm font-medium text-brand-fg hover:text-brand-fg-strong min-h-[44px] inline-flex items-center">
          Your shortlist →
        </Link>
      </header>
      <section aria-label="Find athletes" className="bg-surface rounded-lg border border-border p-4 sm:p-6">
        <ScoutSearch />
      </section>
    </div>
  );
}
