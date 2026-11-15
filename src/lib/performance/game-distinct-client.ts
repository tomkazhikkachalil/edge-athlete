/**
 * "These are two different games" — the browser side (Nov 14 2026). One save,
 * and one signal: the season totals, the career tiles and the game-film list
 * are three readers of the same count, so whichever of them changed a pair
 * tells the other two to read again.
 */
const CHANGED = 'ea:stat-games-changed';

/** Say a pair is two games, or take it back. The server decides who may (the athlete, or their guardian). */
export async function saveDistinctGames(profileId: string, sport: string, a: string, b: string, distinct: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/sports/stat-lines/distinct?profileId=${encodeURIComponent(profileId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sport, a, b, distinct }) });
    if (!res.ok) return { ok: false, error: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not save that.' };
    window.dispatchEvent(new Event(CHANGED));
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not save that. Check your connection and try again.' };
  }
}

/** Run `read` whenever a pair changes; returns the undo for an effect's cleanup. */
export function onStatGamesChanged(read: () => void): () => void {
  window.addEventListener(CHANGED, read);
  return () => window.removeEventListener(CHANGED, read);
}
