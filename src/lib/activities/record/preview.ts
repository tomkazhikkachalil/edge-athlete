// ── The recorder's preview card (Training fixes PR 6, Oct 21 2026) ──────────
// Tom's step 2: "a preview of the post exactly as it will appear". No row
// exists before Post, so the card's snapshot is composed here from the
// recording — through the SAME composition the server uses once the row
// exists (post-card.ts composeActivityPostStats), from the recorder's own
// totals (liveTotals), its drawn route and the answers. What only the stream
// could add (max speed, downhill runs) is left out of the preview.

import { composeActivityPostStats, type ActivityPostStats } from '../post-card';
import { encodePolyline, type LatLng } from '../polyline';
import { sourceCredit } from '../connections';
import { normalizeSegments } from '../segments';
import type { Details } from '../details';
import { elapsedS, type LiveTotals, type RecordingState } from './recording';

export const PREVIEW_ACTIVITY_ID = 'preview';

export function previewActivityPostStats(input: {
  state: RecordingState;
  totals: LiveTotals | null;
  /** The drawn (filtered) route, as the review draws it. */
  route: readonly LatLng[];
  /** A supervised athlete's card carries no map. */
  supervised: boolean;
  name: string;
  /** The typed distance of a timer type, when any (metres). */
  manualDistanceM: number | null;
  effort: number | null;
  details: Details;
  /** The local calendar day the activity happened ("YYYY-MM-DD"). */
  occurredOn: string;
}): ActivityPostStats {
  const { state, totals } = input;
  const elapsed = totals?.elapsedS ?? (state.finishedAt !== null ? elapsedS(state, state.finishedAt) : 0);
  const distance = input.manualDistanceM ?? (totals && totals.distanceM > 0 ? Math.round(totals.distanceM) : null);
  const segments = normalizeSegments(state.segments, elapsed).map(seg => ({ kind: seg.kind, label: seg.label ?? null, distance_m: 0, seconds: Math.max(0, seg.to_s - seg.from_s) }));
  return composeActivityPostStats({
    activityId: PREVIEW_ACTIVITY_ID,
    type: state.type,
    name: input.name,
    occurredOn: input.occurredOn,
    distanceM: distance,
    movingS: totals?.movingS ?? null,
    elapsedS: elapsed,
    elevGainM: totals?.elevGainM ?? null,
    elevLossM: totals?.elevLossM ?? null,
    avgHr: null,
    routePreview: input.supervised || input.route.length < 2 ? null : encodePolyline(input.route),
    credit: sourceCredit('live'),
    segments,
    steps: typeof totals?.steps === 'number' ? totals.steps : null,
    photoCount: state.photos.length,
    effort: input.effort,
    details: input.details,
    derived: {},
  });
}
