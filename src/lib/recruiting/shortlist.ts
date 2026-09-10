// ── Shortlist — the pure half (Recruiting skeleton R3) ────────────────────
// Zero heavy imports (the page and the button read the vocabulary).

export const SHORTLIST_NOTE_MAX = 500;

export interface ShortlistAthlete {
  athleteId: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  sport: string | null;
  school: string | null;
  gradYear: number | null;
  recruitingStatus: 'closed' | 'open' | 'committed';
  note: string | null;
  addedAt: string;
}

/** The note as stored: trimmed, empty → null, clipped to the CHECK. */
export function normalizeShortlistNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t ? t.slice(0, SHORTLIST_NOTE_MAX) : null;
}

/** "Shortlisted by 3 scouts" — the athlete side's count line; null at zero. */
export function shortlistedByLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1 ? 'Shortlisted by 1 scout' : `Shortlisted by ${count} scouts`;
}
