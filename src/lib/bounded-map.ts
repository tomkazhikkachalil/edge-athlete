// ── A bounded-concurrency map (scale audit row 12, Nov 7 2026) ─────────────
// Zero-import rule: `mapBounded(items, limit, fn)` runs `fn` over the items
// with at most `limit` in flight and resolves to the results IN INPUT ORDER.
// A rejected item rejects the whole map (callers that want per-item
// best-effort catch inside `fn` — the roster import does). `limit` below 1
// or not finite runs one at a time.

export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const width = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return results;
}
