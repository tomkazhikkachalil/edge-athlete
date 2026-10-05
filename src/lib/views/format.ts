// Impact numbers on a card: "999", "1.2K", "34K", "3.4M". Pure; pinned in
// __tests__/views-format.test.ts.
export function compactCount(n: number | null | undefined): string {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v < 1000) return String(v);
  const units: [number, string][] = [[1_000_000_000, 'B'], [1_000_000, 'M'], [1_000, 'K']];
  for (const [size, suffix] of units) {
    if (v >= size) {
      const scaled = v / size;
      const text = scaled >= 10 ? String(Math.floor(scaled)) : (Math.floor(scaled * 10) / 10).toFixed(1).replace(/\.0$/, '');
      return `${text}${suffix}`;
    }
  }
  return String(v);
}

/** "1 view" / "12 views"; "1 play" / "300 plays". */
export function countLabel(n: number, noun: 'view' | 'play'): string {
  return `${compactCount(n)} ${noun}${n === 1 ? '' : 's'}`;
}
