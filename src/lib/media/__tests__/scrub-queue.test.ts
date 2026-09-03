import { describe, it, expect } from 'vitest';
import { serialize } from '../scrub-queue';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('serialize (scrub queue)', () => {
  it('runs tasks one at a time, in call order', async () => {
    let live = 0;
    let peak = 0;
    const order: number[] = [];
    const task = (id: number, ticks: number) => async () => {
      live += 1;
      peak = Math.max(peak, live);
      for (let i = 0; i < ticks; i++) await tick();
      order.push(id);
      live -= 1;
      return id;
    };
    const results = await Promise.all([
      serialize(task(1, 3)),
      serialize(task(2, 1)),
      serialize(task(3, 2)),
    ]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]); // the short task did NOT overtake the long one
    expect(peak).toBe(1); // never two scrubs alive at once
  });

  it('passes the task value and rejection through to its own caller', async () => {
    await expect(serialize(async () => 'ok')).resolves.toBe('ok');
    await expect(
      serialize(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });

  it('a rejected task does not poison the chain', async () => {
    const failed = serialize(async () => {
      throw new Error('first');
    });
    const after = serialize(async () => 'second still runs');
    await expect(failed).rejects.toThrow('first');
    await expect(after).resolves.toBe('second still runs');
  });
});
