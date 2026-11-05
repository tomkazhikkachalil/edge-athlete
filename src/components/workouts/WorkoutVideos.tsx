'use client';

import VideosGrid from '@/components/videos/VideosGrid';

/**
 * A workout's linked recording (Videos Phase 1b, 297): one YouTube link per
 * session, shown in the card's expanded body for whoever may see the
 * workout (the workouts rule, applied by the API), silent at zero. The
 * owner's door is on the review screen.
 */
export default function WorkoutVideos({ sessionId }: { sessionId: string }) {
  return (
    <div className="border-t border-border-subtle pt-3" data-workout-videos="">
      <VideosGrid query={`workoutSessionId=${encodeURIComponent(sessionId)}`} addHref={`/videos/new?workoutSessionId=${encodeURIComponent(sessionId)}`} emptyCopy="" hideWhenEmpty hideDoor />
    </div>
  );
}
