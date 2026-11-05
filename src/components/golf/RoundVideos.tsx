'use client';

import SectionInfo from '@/components/SectionInfo';
import VideosGrid from '@/components/videos/VideosGrid';

/**
 * The round's videos (Videos Phase 1b, 297): the full broadcast or a
 * player's own recording of this round, linked from YouTube — on the round
 * card's Media tab for everyone who sees the round (its own gate), with the
 * door for a player (the creator or a confirmed participant, the Media
 * tab's rule). Photos and short clips stay the round's media below.
 */
export default function RoundVideos({ groupPostId, version = 0 }: { groupPostId: string; version?: number }) {
  return (
    <section aria-labelledby="round-videos-heading" className="mb-6" data-round-videos="">
      <SectionInfo heading="Videos" headingId="round-videos-heading" className="mb-3" as="h3" headingClassName="text-base font-semibold text-primary">
        A full recording of this round lives on YouTube and is linked here with its highlights. Photos and short clips from the course are below.
      </SectionInfo>
      <VideosGrid
        query={`groupPostId=${encodeURIComponent(groupPostId)}`}
        addHref={`/videos/new?groupPostId=${encodeURIComponent(groupPostId)}`}
        emptyCopy="No videos yet."
        emptyManagerCopy="No videos yet. Link the full round from YouTube and mark the moments worth jumping to."
        version={version}
      />
    </section>
  );
}
