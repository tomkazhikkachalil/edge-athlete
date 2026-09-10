'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import type { ContestViewResult } from '@/lib/competitions/contest-view';
import ContestPage from './ContestPage';
import ContestPosts from './ContestPosts';
import { appContestLinks } from './links';

// ── The gated branch of /event/[contestId] (Contest Place E1) ────────────
// The server page renders a public competition's contest itself. Anything
// else lands here: fetch the view WITH the session (the API's
// resolveContestAccess decides), render the same body for a member, and
// give everyone else a real screen with a way back — never a redirect
// into nowhere (the navigation conventions). Order of checks matters:
// initialAuthCheckComplete before !user, or a signed-in refresh flashes
// the sign-in prompt.

interface Props {
  contestId: string;
}

export default function ContestGate({ contestId }: Props) {
  const { user, loading: authLoading, initialAuthCheckComplete } = useAuth();
  const [result, setResult] = useState<ContestViewResult | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    if (!initialAuthCheckComplete || authLoading) return;
    let cancelled = false;
    // No synchronous setState here (react-hooks/set-state-in-effect): the
    // route remounts this island per contest id, so 'loading' is the
    // initial state and the async callbacks below move it on.
    (async () => {
      try {
        const res = await fetch(`/api/contests/${contestId}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setState('unavailable');
          return;
        }
        const data = (await res.json()) as ContestViewResult;
        if (cancelled) return;
        setResult(data);
        setState('ready');
      } catch {
        if (!cancelled) setState('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contestId, initialAuthCheckComplete, authLoading, user?.id]);

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 py-6">{body}</main>
    </div>
  );

  if (state === 'loading') {
    return shell(
      <div className="flex items-center justify-center py-16" aria-busy="true">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  if (state === 'unavailable' || !result) {
    return shell(
      <div className="bg-surface rounded-lg border border-border p-6 text-center" data-contest-unavailable="">
        <h1 className="text-h3 font-bold text-primary mb-2">This event isn&apos;t available</h1>
        <p className="text-tertiary mb-4">
          {user
            ? "It may have been removed, or it belongs to an organization you're not part of."
            : 'It may be for members of its organization. Sign in to check.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {user ? (
            <Link href="/feed" className="px-4 py-2 bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover min-h-[44px] inline-flex items-center">
              Back to feed
            </Link>
          ) : (
            <Link href="/" className="px-4 py-2 bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover min-h-[44px] inline-flex items-center">
              Sign in
            </Link>
          )}
          <Link href="/explore" className="px-4 py-2 border border-border-strong rounded-lg font-semibold text-secondary hover:bg-surface-muted min-h-[44px] inline-flex items-center">
            Explore
          </Link>
        </div>
      </div>
    );
  }

  return shell(
    <ContestPage
      view={result.view}
      access={result.access}
      links={appContestLinks(result.view)}
      postsSlot={<ContestPosts contestId={contestId} viewerId={user?.id} />}
    />
  );
}
