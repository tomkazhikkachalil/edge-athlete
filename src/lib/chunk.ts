/** Split items into consecutive batches of at most `size` — extracted from
 *  series-server.ts now that org-event notification fan-outs (uncapped
 *  membership) need it too. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
