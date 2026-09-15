import { cache, Suspense } from 'react';
import type { Metadata } from 'next';
import AppHeader from '@/components/AppHeader';
import EventPlace from '@/components/sport-events/EventPlace';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { roundsSummary } from '@/lib/sport-events/format';
import { activeRounds, currentRound } from '@/lib/sport-events/rounds';
import { fetchSportEventView } from '@/lib/sport-events/view-server';
import { UUID_RE } from '@/lib/uuid';
import EventGate from './_components/EventGate';

// ── /events/[id] — an Event as a PLACE (Events program) ──────────────────
// The contest place's shape: a PUBLIC event renders here on the server,
// viewer-independent (the gate with no viewer), so the page has a title
// and the link works signed-out; the client shell then refetches with the
// session for the viewer's own role. A link, a private or an unknown event
// hands off to the client gate. The server never reads the session and
// never confirms a private event exists to a stranger.

interface PageParams {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}

const getPublicView = cache((id: string) => fetchSportEventView(getSupabaseAdmin(), id, null, null));

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: 'Event' };
  const view = await getPublicView(id);
  if (!view) return { title: 'Event' };
  const round = currentRound(activeRounds(view.rounds));
  const summary = roundsSummary(view.rounds);
  return {
    title: `${view.event.name} — Edge Athlete`,
    description: round ? `${summary} · ${round.course_name}` : 'A golf event on Edge Athlete.',
  };
}

export default async function EventPlacePage({ params, searchParams }: PageParams) {
  const { id } = await params;
  const { token } = await searchParams;
  const presented = typeof token === 'string' && token.length > 0 ? token : null;
  const view = UUID_RE.test(id) ? await getPublicView(id) : null;
  if (!view) return <EventGate eventId={id} token={presented} />;
  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-4 py-6" data-event-access="public">
        <Suspense fallback={null}>
          <EventPlace eventId={id} initialView={view} token={presented} />
        </Suspense>
      </main>
    </div>
  );
}
