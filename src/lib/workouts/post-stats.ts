// ── A posted workout's summary, rebuilt from the session (Training fixes PR 5, Oct 21 2026) ──
// Tom: a posted workout can be edited from the post's menu. The post's
// `stats_data` is a denormalized summary written at Post time; once the sets
// change after posting, the post follows — rebuilt here from the SESSION's
// rows (never taken from the client), the confirmed records kept as they were.
// Pure: the server helper reads the rows and writes the result.

import { computeSummary, buildWorkoutStatsData } from './summary';
import { serverToEntries, type ServerWorkoutSession } from './serialize';

/** The post's new stats_data for a completed session; null when the session is not completed. */
export function workoutPostStatsFromSession(session: ServerWorkoutSession, existing: Record<string, unknown> | null): Record<string, unknown> | null {
  if (session.status !== 'completed') return null;
  const entries = serverToEntries(session);
  const summary = computeSummary(entries);
  const prs = Array.isArray(existing?.prs)
    ? (existing!.prs as Array<{ label?: unknown; display?: unknown }>).filter((pr): pr is { label: string; display: string } => typeof pr?.label === 'string' && typeof pr?.display === 'string')
    : [];
  return buildWorkoutStatsData({
    sessionId: session.id,
    title: session.title,
    durationSeconds: session.timed === false ? null : session.duration_seconds ?? null,
    summary,
    prs,
  });
}
