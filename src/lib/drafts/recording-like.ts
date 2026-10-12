// ── The live recording as a Drafts-list row (resume pill program, Oct 2026) ──
// The root engine (RecordingProvider) holds the recording; the reopen prompt,
// the Drafts page and the resume pill all describe it to buildDraftsList the
// same way through this one function. Pure.

import type { RecordingState } from '@/lib/activities/record/recording';
import type { DraftRecordingLike } from './list';

export function recordingDraftLike(
  state: RecordingState | null,
  lastTouchedAt: number | null,
  defs: Readonly<Record<string, { label: string }>>,
  now: number = Date.now(),
): DraftRecordingLike | null {
  if (!state || state.status === 'idle') return null;
  return {
    id: state.id,
    label: defs[state.type]?.label ?? 'Activity',
    // A recording still RECORDING is the thing being done right now.
    savedAt: state.status === 'recording' ? now : (lastTouchedAt ?? state.startedAt ?? now),
    startedAt: state.startedAt,
    pausedTotalMs: state.pausedTotalMs,
    pausedAt: state.status === 'paused' ? state.pausedAt : state.status === 'finished' ? state.finishedAt : null,
  };
}
