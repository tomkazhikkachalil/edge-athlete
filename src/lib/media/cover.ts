// ── The cover of a post's media (General post composer, Nov 26 2026) ─────────
// Pure, zero imports. The FIRST item of a post's media is its cover: the
// picture the feed card opens on. "Cover" on a selected thumbnail moves that
// item to the front; everything else keeps its order.

/** `list` with the item `id` first. The same array when it is already first
 *  or is not in the list. */
export function moveToCover<T extends { id: string }>(list: readonly T[], id: string): readonly T[] {
  const at = list.findIndex(item => item.id === id);
  if (at <= 0) return list;
  return [list[at], ...list.slice(0, at), ...list.slice(at + 1)];
}

/** Is this item the cover? */
export function isCover<T extends { id: string }>(list: readonly T[], id: string): boolean {
  return list.length > 0 && list[0].id === id;
}
