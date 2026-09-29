/**
 * Which live bell is a celebration — the Play program (244). Pure.
 *
 * A badge bell (type `achievement`, carrying `badge_keys`) that arrives on
 * the bell's realtime channel while the athlete is in the app earns the
 * confetti + a toast (lib/celebrate.ts — reduced motion respected there). A
 * guardian's COPY (metadata.profile_id names the child) is a toast only: the
 * confetti belongs to the one who earned it.
 */
export interface BellLike {
  type: string;
  title: string;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type Celebration = { confetti: boolean; title: string; message: string | null };

export function celebrationFor(n: BellLike): Celebration | null {
  if (n.type !== 'achievement') return null;
  const keys = n.metadata?.badge_keys;
  if (!Array.isArray(keys) || keys.length === 0) return null;
  return { confetti: !n.metadata?.profile_id, title: n.title, message: n.message ?? null };
}
