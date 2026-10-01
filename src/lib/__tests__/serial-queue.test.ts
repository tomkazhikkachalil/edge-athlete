import { describe, expect, it } from 'vitest';
import { createSerialQueue } from '../serial-queue';

// Oct 1 2026: two theme saves in quick succession crossed on the wire and
// the older one won. The queue is what keeps whole-object saves in order.

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(r => setTimeout(r, 0));

describe('createSerialQueue', () => {
  it('a later task does not START until the earlier one has settled — however slow it is', async () => {
    const enqueue = createSerialQueue();
    const first = deferred<string>();
    const log: string[] = [];
    const a = enqueue(async () => { log.push('a:start'); const v = await first.promise; log.push('a:end'); return v; });
    const b = enqueue(async () => { log.push('b:start'); return 'b'; });
    await tick();
    expect(log).toEqual(['a:start']); // b is waiting, not racing
    first.resolve('a');
    expect(await a).toBe('a');
    expect(await b).toBe('b');
    expect(log).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('each caller gets its own result, in order, for many tasks', async () => {
    const enqueue = createSerialQueue();
    const order: number[] = [];
    const results = await Promise.all(
      [30, 0, 10, 0].map((ms, i) => enqueue(async () => { await new Promise(r => setTimeout(r, ms)); order.push(i); return i * 2; }))
    );
    expect(results).toEqual([0, 2, 4, 6]);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('a failed task rejects for ITS caller and the queue carries on', async () => {
    const enqueue = createSerialQueue();
    const boom = enqueue(async () => { throw new Error('boom'); });
    const after = enqueue(async () => 'still running');
    await expect(boom).rejects.toThrow('boom');
    expect(await after).toBe('still running');
  });
});
