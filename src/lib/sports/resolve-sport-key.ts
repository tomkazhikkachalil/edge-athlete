// ── Sport label → canonical key resolution ────────────────────────────────────
// profiles.sport stores the registry DISPLAY NAME ("Golf", "Ice Hockey") —
// ~12 UI sites render the raw string and explore filters by it, so the label
// is the storage format for now (canonical-key migration is Foundation-sprint
// debt). This resolver is the ONE place that maps either form back to a
// SportKey; it replaces two byte-identical copies that lived in the
// public-profile and active-sports API routes.

import { SPORT_REGISTRY, type SportKey } from './SportRegistry';
import { getStatSchema } from './stat-schemas';

/** Resolve a sport key OR display name (case-insensitive) to its SportKey. */
export function resolveSportKey(sport: string | null | undefined): SportKey | null {
  if (!sport) return null;
  const lower = sport.toLowerCase();
  if (lower in SPORT_REGISTRY) return lower as SportKey;
  const match = Object.values(SPORT_REGISTRY).find(
    d => d.display_name.toLowerCase() === lower
  );
  return match ? match.sport_key : null;
}

/**
 * Sports the composer can meaningfully default to: golf (full scorecard UI)
 * or any sport with a stat-line schema. Schema-less sports must NOT be
 * auto-selected (they render nothing sport-specific). 'training' is a post
 * category, not a SportKey, since migration 077.
 */
export function isComposerSport(key: SportKey | null): key is SportKey {
  if (!key) return false;
  if (key === 'golf') return true;
  return getStatSchema(key) !== null;
}
