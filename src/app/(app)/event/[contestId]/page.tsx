import { cache } from 'react';
import type { Metadata } from 'next';
import AppHeader from '@/components/AppHeader';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { fetchContestView } from '@/lib/competitions/contest-view';
import { contestTitle } from '@/lib/competitions/contest-format';
import { UUID_RE } from '@/lib/uuid';
import ContestPage from './_components/ContestPage';
import ContestGate from './_components/ContestGate';
import ContestPosts from './_components/ContestPosts';
import { appContestLinks } from './_components/links';

// ── /event/[contestId] — a contest as a PLACE (Contest Place E1) ─────────
// Two entry points, one reader. A PUBLIC competition's contest is rendered
// here on the server, viewer-independent (fetchContestView with no viewer,
// the /league/[id]/standings shape): the scoreline is in the HTML, the
// page has a title, the link is shareable signed-out. Everything else —
// a private competition, a private org, an unknown id — hands off to the
// client gate, which fetches with the session and renders the same body
// for a member or a real not-available screen for everyone else. The
// server never reads the session (API CLAUDE.md), and the page never
// confirms a private contest exists to a stranger.

interface PageParams {
  params: Promise<{ contestId: string }>;
}

const getPublicView = cache((id: string) =>
  fetchContestView(getSupabaseAdmin(), id, { viewerId: null })
);

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { contestId } = await params;
  if (!UUID_RE.test(contestId)) return { title: 'Event' };
  const result = await getPublicView(contestId);
  if (!result) return { title: 'Event' };
  return {
    title: contestTitle(result.view),
    description: `${result.view.competition.name} · ${result.view.org.name} on Edge Athlete.`,
  };
}

export default async function ContestPlacePage({ params }: PageParams) {
  const { contestId } = await params;
  const result = UUID_RE.test(contestId) ? await getPublicView(contestId) : null;
  if (!result) return <ContestGate contestId={contestId} />;

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 py-6">
        <ContestPage
          view={result.view}
          access={result.access}
          links={appContestLinks(result.view)}
          postsSlot={<ContestPosts contestId={contestId} />}
        />
      </main>
    </div>
  );
}
