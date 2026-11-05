'use client';

import SectionInfo from '@/components/SectionInfo';
import VideosGrid from '@/components/videos/VideosGrid';
import type { SportEventViewPayload } from '@/lib/sport-events/view';

interface Props {
  view: SportEventViewPayload;
  version: number;
}

/**
 * The Videos tab (Videos program, 296): the full games and long videos
 * linked to this event — everyone who sees the event sees them (a
 * profile-owned video still answers to its owner's privacy, row by row);
 * an organizer adds one (the link comes with the event pre-filled).
 */
export default function EventVideosTab({ view, version }: Props) {
  const eventId = view.event.id;
  return (
    <section aria-labelledby="event-videos-heading" data-event-videos="">
      <SectionInfo heading="Videos" headingId="event-videos-heading" className="mb-4">
        Full broadcasts and long recordings of this event, hosted on YouTube and linked here with their highlights. Photos and short clips are in the Gallery.
      </SectionInfo>
      <VideosGrid
        query={`sportEventId=${encodeURIComponent(eventId)}`}
        addHref={`/videos/new?sportEventId=${encodeURIComponent(eventId)}`}
        emptyCopy="No videos yet."
        emptyManagerCopy="No videos yet. Link the full broadcast from YouTube and mark the moments worth jumping to."
        version={version}
      />
    </section>
  );
}
