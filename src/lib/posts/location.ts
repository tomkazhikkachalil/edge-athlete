// ── A post's one location (General post spec, Nov 26 2026; migration 321) ────
// Pure, zero imports. The card shows a label ("Ottawa, ON"); the place it
// was picked from is kept beside it when there was one. One location per
// post; removing it stores nothing.

export const MAX_LOCATION_LABEL = 120;

export interface PostLocation {
  label: string;
  placeId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A request's `location`, checked: null when absent or blank, 'invalid' when malformed. */
export function parsePostLocation(value: unknown): PostLocation | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return 'invalid';
  const { label, placeId } = value as { label?: unknown; placeId?: unknown };
  if (typeof label !== 'string') return 'invalid';
  const text = label.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  if (text.length > MAX_LOCATION_LABEL) return 'invalid';
  if (placeId !== null && placeId !== undefined && (typeof placeId !== 'string' || !UUID.test(placeId))) return 'invalid';
  return { label: text, placeId: typeof placeId === 'string' ? placeId : null };
}

/** The location a post row holds, for the card. */
export function locationOf(row: { location_label?: unknown }): string | null {
  return typeof row.location_label === 'string' && row.location_label.trim() !== '' ? row.location_label : null;
}
