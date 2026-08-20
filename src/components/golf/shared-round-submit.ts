// ── Shared-round submission ───────────────────────────────────────────────────
// The shared-round fork of CreatePostModal's handleSubmit, moved out wholesale
// (sport-cleanup D-2). The request bodies sent here — /api/group-posts (atomic
// round create), /api/golf/participant-scores (initial scores), and the
// per-file /api/group-posts/[id]/media attach — must stay byte-identical to
// what the composer sent before the extraction; do not rename keys.
//
// Throws on round-create failure (the caller's catch shows the generic
// failure toast, exactly as before). Partial failures after the round exists
// (scores, media) surface their own toasts here and do NOT throw — the round
// is real and the user can repair it from the post.

import type { GolfComposerValue } from '@/components/golf/GolfComposerSection';
import type { CreatedRoundLike } from '@/lib/golf/round-route';

export interface SharedRoundSubmitContext<M extends { type: 'image' | 'video' }> {
  caption: string;
  visibility: 'public' | 'private';
  mediaFiles: M[];
  /** Guardian acting-as: the athlete the round belongs to. The composer
   *  already SHOWS the athlete as the creator — without this the round
   *  silently landed on the guardian's profile. */
  targetProfileId?: string | null;
  /** Uploads one media file (+ its video poster frame) — stays owned by the
   *  composer, which knows the editor's file shapes. */
  uploadMediaWithPoster: (file: M) => Promise<{ url: string; thumbnailUrl?: string }>;
  showSuccess: (title: string, message?: string) => void;
  showError: (title: string, message?: string) => void;
}

/** Creates the round (+ scores, + media) and returns the created group post
 *  for the caller's onPostCreated / enter-the-scorer routing. */
export async function submitSharedRound<M extends { type: 'image' | 'video' }>(
  value: GolfComposerValue,
  ctx: SharedRoundSubmitContext<M>
): Promise<CreatedRoundLike> {
  const {
    sharedRoundDetails,
    sharedRoundParticipants,
    courseHoleData,
    manualParEntry,
    manualYardageEntry,
    playerScores,
  } = value;
  const { caption, visibility, mediaFiles, uploadMediaWithPoster, showSuccess, showError } = ctx;

  // Step 1: Create the round ATOMICALLY — group post, participants,
  // scorecard, and feed post in one server request. If any piece fails
  // the server rolls the whole thing back (no more rounds whose card
  // renders nothing because a follow-up scorecard call died).
  const groupPostResponse = await fetch('/api/group-posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      ...(ctx.targetProfileId ? { targetProfileId: ctx.targetProfileId } : {}),
      type: 'golf_round',
      title: `Golf at ${sharedRoundDetails.courseName}`,
      description: caption.trim() || undefined,
      date: sharedRoundDetails.date,
      location: sharedRoundDetails.courseName,
      visibility: visibility,
      participant_ids: sharedRoundParticipants,
      already_played: sharedRoundDetails.alreadyPlayed || undefined,
      golf_data: {
        course_name: sharedRoundDetails.courseName,
        round_type: sharedRoundDetails.roundTypeIndoorOutdoor,
        game_format: sharedRoundDetails.gameFormat,
        holes_played: sharedRoundDetails.holesPlayed,
        // Real per-hole pars (course search or manual entry) — powers
        // honest to-par + the score-entry modal's par display
        hole_data:
          courseHoleData.length > 0
            ? courseHoleData
            : manualParEntry.length > 0 || manualYardageEntry.length > 0
            ? Array.from({ length: sharedRoundDetails.holesPlayed }, (_, i) => ({
                hole: i + 1,
                par: manualParEntry[i] || 4,
                yardage: manualYardageEntry[i] || undefined,
              }))
            : undefined,
        tee_color: sharedRoundDetails.teeColor || undefined,
        weather_conditions: sharedRoundDetails.weather || undefined,
        temperature: sharedRoundDetails.temperature ? parseInt(sharedRoundDetails.temperature) : undefined,
        wind_speed: sharedRoundDetails.wind === 'calm' ? 0 :
                    sharedRoundDetails.wind === 'light' ? 7 :
                    sharedRoundDetails.wind === 'moderate' ? 15 :
                    sharedRoundDetails.wind === 'strong' ? 25 : undefined,
      },
    }),
  });

  if (!groupPostResponse.ok) {
    const errorData = await groupPostResponse.json();
    throw new Error(errorData.error || 'Failed to create shared round');
  }

  const groupPostResult = await groupPostResponse.json();
  const groupPostId = groupPostResult.group_post.id;

  // Step 2: initial scores, if any were entered in the modal (the
  // scorecard itself was created atomically in step 1).
  const hasScores = playerScores.length > 0 && playerScores.some(p =>
    p.hole_scores.some(h => h.strokes !== undefined && h.strokes > 0)
  );

  const scoresPromise = hasScores
    ? fetch('/api/golf/participant-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          group_post_id: groupPostId,
          participant_scores: playerScores.map(player => ({
            participant_id: player.participant_id,
            hole_scores: player.hole_scores
              .filter(hole => hole.strokes !== undefined && hole.strokes > 0)
              .map(hole => {
                // Add par and yardage from course data if available
                const holeInfo = courseHoleData.find(h => h.hole === hole.hole_number) ||
                  (manualParEntry.length > 0 || manualYardageEntry.length > 0
                    ? {
                        par: manualParEntry[hole.hole_number - 1] || undefined,
                        yardage: manualYardageEntry[hole.hole_number - 1] || undefined
                      }
                    : {});

                return {
                  ...hole,
                  par: holeInfo.par,
                  yardage: holeInfo.yardage
                };
              })
          }))
        }),
      })
    : Promise.resolve(null);

  const [scoresResult] = await Promise.allSettled([scoresPromise]);

  if (hasScores && (scoresResult.status === 'rejected' || (scoresResult.status === 'fulfilled' && scoresResult.value && !scoresResult.value.ok))) {
    // Surface it — silently losing entered scores erodes trust. The
    // round itself is fine; scores are re-enterable from the post.
    console.error('Failed to save participant scores');
    showError('Round created, but some scores could not be saved. You can re-enter them from the post.');
  }

  // Attach any composer media to the ROUND. This branch used to return
  // before the media upload further down, so photos added to an
  // already-played shared round were silently discarded — no error, no
  // upload, just gone. Routing them through the round's media endpoint
  // also means the round->post mirror carries them onto the feed card,
  // and that endpoint re-mirrors when the round is already 'completed'
  // (which every already-played round is).
  if (mediaFiles.length > 0) {
    const attached = await Promise.allSettled(
      mediaFiles.map(async file => {
        const { url, thumbnailUrl } = await uploadMediaWithPoster(file);
        const res = await fetch(`/api/group-posts/${groupPostId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            media_url: url,
            media_type: file.type === 'video' ? 'video' : 'image',
            thumbnail_url: thumbnailUrl,
          }),
        });
        if (!res.ok) throw new Error('attach failed');
      })
    );
    if (attached.some(r => r.status === 'rejected')) {
      showError('Round posted, but some photos could not be attached.');
    }
  }

  if (!sharedRoundDetails.alreadyPlayed) {
    showSuccess(
      sharedRoundParticipants.length > 0
        ? 'Round is LIVE! Scores stream to your group as you play. 🔴'
        : 'Round is LIVE! 🔴'
    );
  } else {
    showSuccess('Round posted! Participants will be notified. 🎉');
  }

  return groupPostResult.group_post;
}
