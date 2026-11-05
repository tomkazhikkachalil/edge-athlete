'use client';

import VideosGrid from '@/components/videos/VideosGrid';

/**
 * The contest's videos (Videos program, 296) — the client island inside
 * the server-rendered ContestPage (the ContestPosts shape): the full
 * games linked to this game, the competition manager's door. The API's
 * gate is the contest's own (public competition + public org: everyone;
 * else a member).
 */
export default function ContestVideos({ contestId }: { contestId: string }) {
  return (
    <VideosGrid
      query={`contestId=${encodeURIComponent(contestId)}`}
      addHref={`/videos/new?contestId=${encodeURIComponent(contestId)}`}
      emptyCopy="No videos yet."
      emptyManagerCopy="No videos yet. Link the full game from YouTube and mark its highlights."
    />
  );
}
