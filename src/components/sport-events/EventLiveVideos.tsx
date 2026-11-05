'use client';

import VideosGrid from '@/components/videos/VideosGrid';

/**
 * The broadcast beside the live stats (Videos Phase 1b): the event's
 * linked videos, read-only here (the Videos tab holds the door), silent
 * when there are none. A link-only event forwards its token.
 */
export default function EventLiveVideos({ eventId, token }: { eventId: string; token: string | null }) {
  const query = `sportEventId=${encodeURIComponent(eventId)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  return (
    <div data-event-live-videos="">
      <VideosGrid query={query} addHref={`/videos/new?sportEventId=${encodeURIComponent(eventId)}`} emptyCopy="" hideWhenEmpty hideDoor />
    </div>
  );
}
