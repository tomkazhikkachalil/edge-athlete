// Contact-roster shaping (Wave 3) — pure and node-testable. The guardian
// sees WHO their child talks to, since when, and roughly how much — NEVER
// what was said (standing line: no DM transcripts ever). Volume is a coarse
// band, not a count, so the roster can't be read as a activity log.

export type VolumeBand = 'few' | 'regular' | 'frequent';

export function volumeBand(messageCount: number): VolumeBand {
  if (messageCount >= 100) return 'frequent';
  if (messageCount >= 10) return 'regular';
  return 'few';
}

export const VOLUME_BAND_LABEL: Record<VolumeBand, string> = {
  few: 'a few messages',
  regular: 'regular messages',
  frequent: 'frequent messages',
};

export type ContactState = 'blocked' | 'held' | 'denied' | 'approved';

/** Precedence: blocked > held > denied > approved — the strongest standing
 *  restriction wins the chip. */
export function contactState(input: {
  blocked: boolean;
  held: boolean;
  ledgerStatus: 'approved' | 'denied' | null;
}): ContactState {
  if (input.blocked) return 'blocked';
  if (input.held) return 'held';
  if (input.ledgerStatus === 'denied') return 'denied';
  return 'approved';
}

/** The earlier of two ISO timestamps, tolerating nulls. */
export function earliestIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
