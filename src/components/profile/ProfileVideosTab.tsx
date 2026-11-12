'use client';

import SectionInfo from '@/components/SectionInfo';
import VideosGrid from '@/components/videos/VideosGrid';
import YouTubeConnectCard from '@/components/videos/YouTubeConnectCard';
import TaggedGames from '@/components/videos/TaggedGames';

interface Props {
  profileId: string;
  isOwnProfile: boolean;
  currentUserId?: string;
  onCountsChanged?: (count: number) => void;
}

/**
 * The profile's Videos tab (Videos program, 296): the full games and long
 * videos this athlete linked, on /athlete, /athlete/[id] and /u/[username]
 * alike. The owner (or a guardian) gets "Add a full game" — Convention 52's
 * tab-action exception: an activity, not a setting. Who sees the list is
 * the profile's own privacy (the API's rule); a hidden video is the owner's.
 */
export default function ProfileVideosTab({ profileId, isOwnProfile, currentUserId, onCountsChanged }: Props) {
  const addHref = isOwnProfile || currentUserId === profileId ? '/videos/new' : `/videos/new?profileId=${encodeURIComponent(profileId)}`;
  return (
    <section aria-labelledby="profile-videos-heading" data-profile-videos="">
      <SectionInfo heading="Videos" headingId="profile-videos-heading" className="mb-4">
        Full games, tournaments and long videos live on YouTube; this is where they are linked and their highlights marked. Short clips are posts — find them under Media.
      </SectionInfo>
      {/* Phase 3 (298): the owner's (or a guardian's) channel — the card hides itself for anyone else. */}
      {(isOwnProfile || currentUserId === profileId) && (
        <div className="mb-4">
          <YouTubeConnectCard owner={`profile:${profileId}`} />
        </div>
      )}
      <VideosGrid
        query={`profileId=${encodeURIComponent(profileId)}`}
        addHref={addHref}
        emptyCopy="No videos yet."
        emptyManagerCopy="No videos yet. Link a full game from YouTube and mark the moments worth jumping to."
        onLoaded={count => onCountsChanged?.(count)}
      />
      {/* Sprint 3 PR 7: games someone else tagged this athlete in — clips and stats, with the link back. */}
      <TaggedGames profileId={profileId} />
    </section>
  );
}
