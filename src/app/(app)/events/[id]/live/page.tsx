import { cache } from 'react';
import type { Metadata } from 'next';
import EventLiveScreen from '@/components/sport-events/EventLiveScreen';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { fetchSportEventView } from '@/lib/sport-events/view-server';
import { UUID_RE } from '@/lib/uuid';

// ── /events/[id]/live — the live stat screen (Events program, phase 4) ──
// The event page's shape: a PUBLIC event's view renders from the server
// (viewer-independent, titled, reachable signed out); a link, a private
// or an unknown event hands off to the client, which fetches with the
// session. The stats themselves are always the client's poll.

interface PageParams {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; round?: string }>;
}

const getPublicView = cache((id: string) => fetchSportEventView(getSupabaseAdmin(), id, null, null));

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: 'Live' };
  const view = await getPublicView(id);
  return { title: view ? `${view.event.name} · Live — Edge Athlete` : 'Live' };
}

export default async function EventLivePage({ params, searchParams }: PageParams) {
  const { id } = await params;
  const { token, round } = await searchParams;
  const presented = typeof token === 'string' && token.length > 0 ? token : null;
  const view = UUID_RE.test(id) ? await getPublicView(id) : null;
  return <EventLiveScreen eventId={id} initialView={view} token={presented} roundParam={typeof round === 'string' && UUID_RE.test(round) ? round : null} />;
}
