// ── The players' handicaps on the round's last step (Oct 29 2026) — pure ───
// Tom's spec, step 6: "If the player has a handicap, append it to their name
// line." The only handicap readable for ANOTHER player is the app's computed
// estimate (handicap-server.ts fetchHandicapComputation — the profile card's
// "Handicap est."; the self-reported index is owner-only). GET
// /api/golf/handicaps?ids=a,b,c answers it for a short list, each id behind
// the privacy gate; this module is the route's pure half: the id list's
// parsing and cap, and the ONE spelling of the line (EventPlayers' "· index
// 12.4", Tom's pick over "HCP").

export const HANDICAPS_MAX_IDS = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `ids=a,b,c` → the distinct UUIDs, in order, capped; junk dropped. */
export function parseHandicapIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase();
    if (!UUID.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= HANDICAPS_MAX_IDS) break;
  }
  return out;
}

/** The suffix after a player's name: " · index 12.4", "" when unknown. */
export function handicapSuffix(formatted: string | null | undefined): string {
  return formatted ? ` · index ${formatted}` : '';
}
