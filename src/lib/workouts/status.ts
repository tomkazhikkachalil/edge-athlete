/**
 * Workout session lifecycle — status derives from data, never from an
 * in-memory clock (golf round-status stance). Abandoned live sessions
 * auto-end lazily: display/reads treat >6h-idle actives as completed, and
 * the API persists that on the owner's next read or Start-Workout attempt.
 * No cron.
 */

export const AUTO_END_AFTER_MS = 6 * 60 * 60 * 1000;

export type WorkoutStatus = 'active' | 'completed';

export function effectiveSessionStatus(s: {
  status: WorkoutStatus | string;
  lastActivityAt: string | null;
  now?: number;
}): WorkoutStatus {
  if (s.status !== 'active') return 'completed';
  if (!s.lastActivityAt) return 'active';
  const now = s.now ?? Date.now();
  const idle = now - Date.parse(s.lastActivityAt);
  return idle > AUTO_END_AFTER_MS ? 'completed' : 'active';
}

/** Fields to persist when finalizing a stale (abandoned) active session. */
export function staleFinalizeFields(s: {
  startedAt: string;
  lastActivityAt: string;
}): { status: 'completed'; ended_at: string; duration_seconds: number } {
  const started = Date.parse(s.startedAt);
  const ended = Math.max(started, Date.parse(s.lastActivityAt));
  return {
    status: 'completed',
    ended_at: new Date(ended).toISOString(),
    duration_seconds: Math.floor((ended - started) / 1000),
  };
}
