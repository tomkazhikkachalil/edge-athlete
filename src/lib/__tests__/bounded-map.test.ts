import { describe, it, expect } from 'vitest';
import { mapBounded } from '../bounded-map';

// Scale audit row 12 (Nov 7 2026): the roster import runs its rows a few at
// a time through mapBounded — the results come back in INPUT order, never
// more than `limit` in flight, and a bad limit degrades to one at a time.

const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe('mapBounded', () => {
  it('keeps input order whatever finishes first', async () => {
    const delays = [30, 5, 20, 1, 10];
    const out = await mapBounded(delays, 3, async (d, i) => {
      await new Promise(r => setTimeout(r, d));
      return `${i}:${d}`;
    });
    expect(out).toEqual(['0:30', '1:5', '2:20', '3:1', '4:10']);
  });
  it('never has more than the limit in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapBounded(Array.from({ length: 12 }, (_, i) => i), 5, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      await tick();
      inFlight -= 1;
    });
    expect(peak).toBe(5);
  });
  it('a limit below one, NaN or infinite runs one at a time; an empty list resolves empty', async () => {
    for (const limit of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      let inFlight = 0;
      let peak = 0;
      const out = await mapBounded([1, 2, 3], limit, async n => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
        return n * 2;
      });
      expect(out).toEqual([2, 4, 6]);
      expect(peak, `limit ${limit} serialises`).toBe(1);
    }
    expect(await mapBounded([], 5, async () => 1)).toEqual([]);
  });
  it('a rejection rejects the map (per-item best-effort is the caller\'s catch)', async () => {
    await expect(mapBounded([1, 2], 2, async n => { if (n === 2) throw new Error('boom'); return n; })).rejects.toThrow('boom');
  });
});
