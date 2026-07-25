// ── "Which sports does this athlete play?" ────────────────────────────────────
// Pure union logic behind GET /api/profile/[id]/active-sports, extracted so
// it's testable and so intake-declared sports (sport_settings rows) join the
// union alongside the declared label and posted sport_keys.

import { SPORT_REGISTRY, type SportKey } from './SportRegistry';
import { resolveSportKey } from './resolve-sport-key';

export interface ActiveSportsInput {
  /** profiles.sport — display name or key, may be null */
  declaredSport: string | null;
  /** posts.sport_key values (raw, may include general/training/null) */
  postSportKeys: (string | null)[];
  /** sport_settings.sport_key rows — intake-declared sports */
  settingsSportKeys: string[];
}

/**
 * Declared sport leads, then registry order. Enabled sports only; the
 * cross-cutting post categories ('general', 'training') never count.
 */
export function computeActiveSports(input: ActiveSportsInput): SportKey[] {
  const active = new Set<SportKey>();

  const declared = resolveSportKey(input.declaredSport);
  if (declared && SPORT_REGISTRY[declared]?.enabled) active.add(declared);

  const addRaw = (raw: string | null) => {
    if (!raw || raw === 'general' || raw === 'training') return;
    const key = raw as SportKey;
    if (SPORT_REGISTRY[key]?.enabled) active.add(key);
  };
  for (const raw of input.postSportKeys) addRaw(raw);
  for (const raw of input.settingsSportKeys) addRaw(raw);

  const ordered: SportKey[] = [];
  if (declared && active.has(declared)) ordered.push(declared);
  for (const key of Object.keys(SPORT_REGISTRY) as SportKey[]) {
    if (active.has(key) && !ordered.includes(key)) ordered.push(key);
  }
  return ordered;
}
