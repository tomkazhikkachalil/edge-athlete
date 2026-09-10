// ── Contest attachments — pure (Contest Place E2) ─────────────────────────
// Zero imports: PostCard (a client chunk) reads the chip label, and the
// server stamp reads the target ids from the results' payloads.

export interface AttachmentTargets {
  roundIds: string[];
  groupPostIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The rounds and live rounds a contest's current results reference —
 *  the golf sync's `payload.roundRef` — as de-duplicated, well-formed ids. */
export function attachmentTargets(
  payloads: ReadonlyArray<Record<string, unknown> | null | undefined>
): AttachmentTargets {
  const roundIds = new Set<string>();
  const groupPostIds = new Set<string>();
  for (const p of payloads) {
    const ref = p?.roundRef as { roundId?: unknown; groupPostId?: unknown } | undefined;
    if (!ref || typeof ref !== 'object') continue;
    if (typeof ref.roundId === 'string' && UUID.test(ref.roundId)) roundIds.add(ref.roundId);
    if (typeof ref.groupPostId === 'string' && UUID.test(ref.groupPostId)) groupPostIds.add(ref.groupPostId);
  }
  return { roundIds: [...roundIds], groupPostIds: [...groupPostIds] };
}

/** "House League · Week 1" — the feed card's chip and the page's nav. */
export function contestChipLabel(contest: { competition_name: string; round: string | null }): string {
  const round = contest.round?.trim();
  return round ? `${contest.competition_name} · ${round}` : contest.competition_name;
}
