import { describe, it, expect } from 'vitest';
import { aggregateGolfHighlights, type CompletedRoundLike } from '../stats-aggregate';

const solo = (grossScore: number, date: string, extra: Partial<CompletedRoundLike> = {}): CompletedRoundLike =>
  ({ grossScore, date, source: 'solo', ...extra });
const shared = (grossScore: number, date: string): CompletedRoundLike =>
  ({ grossScore, date, source: 'shared' });

const tile = (tiles: ReturnType<typeof aggregateGolfHighlights>, label: string) =>
  tiles.find(t => t.label === label)?.value;

describe('aggregateGolfHighlights', () => {
  it('returns all-null tiles for no rounds', () => {
    const tiles = aggregateGolfHighlights([]);
    expect(tiles).toHaveLength(6);
    expect(tiles.every(t => t.value === null)).toBe(true);
  });

  it('matches the historical solo-only route math (regression)', () => {
    // 6 rounds, newest first by date: Last 5 Avg over the 5 newest,
    // Best 18 over all, one-decimal rounding.
    const tiles = aggregateGolfHighlights([
      solo(80, '2026-07-06', { fir: 50, gir: 40, putts: 30 }),
      solo(85, '2026-07-05', { fir: 60, gir: 50, putts: 32 }),
      solo(78, '2026-07-04'),
      solo(90, '2026-07-03'),
      solo(82, '2026-07-02'),
      solo(74, '2026-07-01'), // outside the Last-5 window, still Best 18
    ]);
    expect(tile(tiles, 'Last 5 Avg')).toBe('83'); // (80+85+78+90+82)/5 = 83
    expect(tile(tiles, 'Best 18')).toBe('74');
    expect(tile(tiles, 'FIR%')).toBe('55%');
    expect(tile(tiles, 'GIR%')).toBe('45%');
    expect(tile(tiles, 'Putts/Round')).toBe('31');
    expect(tile(tiles, 'Rounds')).toBe('6');
  });

  it('interleaves shared rounds into the Last-5 window by date, not input order', () => {
    const tiles = aggregateGolfHighlights([
      // Input deliberately unordered: solo block first, shared appended after
      solo(88, '2026-07-01'),
      solo(90, '2026-06-01'),
      solo(92, '2026-05-01'),
      solo(94, '2026-04-01'),
      solo(96, '2026-03-01'),
      shared(80, '2026-07-15'), // newest round of all — must displace the oldest solo
    ]);
    // Window = 80,88,90,92,94 → 88.8 (96 from March drops out)
    expect(tile(tiles, 'Last 5 Avg')).toBe('88.8');
    expect(tile(tiles, 'Best 18')).toBe('80');
    expect(tile(tiles, 'Rounds')).toBe('6');
  });

  it('shared-only profile: score tiles populate, per-hole stat tiles stay null', () => {
    const tiles = aggregateGolfHighlights([shared(85, '2026-07-10'), shared(79, '2026-07-01')]);
    expect(tile(tiles, 'Last 5 Avg')).toBe('82');
    expect(tile(tiles, 'Best 18')).toBe('79');
    expect(tile(tiles, 'Rounds')).toBe('2');
    expect(tile(tiles, 'FIR%')).toBeNull();
    expect(tile(tiles, 'GIR%')).toBeNull();
    expect(tile(tiles, 'Putts/Round')).toBeNull();
  });

  it('averages per-round stats only over rounds that track them', () => {
    const tiles = aggregateGolfHighlights([
      solo(80, '2026-07-02', { putts: 30 }),
      shared(82, '2026-07-01'), // no putts — must not drag the average
    ]);
    expect(tile(tiles, 'Putts/Round')).toBe('30');
  });
});
