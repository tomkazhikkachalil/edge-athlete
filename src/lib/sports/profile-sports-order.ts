// ── Sports on the profile: the ONE ordering rule (Oct 14 2026) ───────────────
// Pure, zero imports — string keys so this file imports nothing. Pinned
// sports lead (by the athlete's pin order, the registry's order as the
// tiebreak); the rest follow: the declared primary first (when it is active
// and unpinned), then registry order. A key the registry does not know is
// dropped; a pin on a sport that is not active is ignored (a removed row's
// pin never resurrects the sport). The reader (sports/server/index.ts) and
// nothing else decides order — the strip, the Stats chips and /u/ share it.

export interface ProfileSportsOrderInput {
  /** The active sport keys (declared ∪ settings rows ∪ posted ∪ played), any order. */
  active: string[];
  /** The pinned rows: key → 1-based order. Gaps are allowed. */
  pins: Array<{ key: string; order: number }>;
  /** The declared primary (profiles.sport resolved to a key), or null. */
  primary: string | null;
  /** SPORT_REGISTRY's keys in declaration order. */
  registryOrder: string[];
}

export function orderProfileSports(input: ProfileSportsOrderInput): { pinned: string[]; rest: string[] } {
  const rank = new Map(input.registryOrder.map((k, i) => [k, i]));
  const active = new Set(input.active.filter(k => rank.has(k)));
  const pinned = input.pins
    .filter(p => active.has(p.key))
    .sort((a, b) => a.order - b.order || rank.get(a.key)! - rank.get(b.key)!)
    .map(p => p.key)
    .filter((k, i, arr) => arr.indexOf(k) === i);
  const pinnedSet = new Set(pinned);
  const rest: string[] = [];
  if (input.primary && active.has(input.primary) && !pinnedSet.has(input.primary)) rest.push(input.primary);
  for (const k of input.registryOrder) {
    if (active.has(k) && !pinnedSet.has(k) && !rest.includes(k)) rest.push(k);
  }
  return { pinned, rest };
}
