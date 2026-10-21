import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWakeLockController, type WakeLockSentinelLike } from '../wake-lock-controller';

/** A fake screen lock: records releases and can be dropped by the "OS". */
function fakeLock() {
  let releaseListener: (() => void) | null = null;
  const lock = {
    released: 0,
    release: async () => { lock.released++; },
    addEventListener: (_type: 'release', listener: () => void) => { releaseListener = listener; },
    dropByOs: () => releaseListener?.(),
  };
  return lock;
}

function harness() {
  const issued: ReturnType<typeof fakeLock>[] = [];
  const held: boolean[] = [];
  let failNext = false;
  const controller = createWakeLockController(async (): Promise<WakeLockSentinelLike> => {
    if (failNext) { failNext = false; throw new Error('NotAllowedError'); }
    const l = fakeLock();
    issued.push(l);
    return l;
  }, h => held.push(h));
  return { controller, issued, held, failOnce: () => { failNext = true; } };
}

describe('the screen wake lock', () => {
  it('holds the lock once asked', async () => {
    const { controller, issued, held } = harness();
    await controller.acquire();
    expect(issued).toHaveLength(1);
    expect(held.at(-1)).toBe(true);
  });

  it('asking again on return releases the old lock first — never two held', async () => {
    const { controller, issued } = harness();
    await controller.acquire();
    await controller.acquire();
    expect(issued).toHaveLength(2);
    expect(issued[0].released).toBe(1);
    expect(issued[1].released).toBe(0);
  });

  it('a late "released" from a replaced lock does not say the screen is unlocked', async () => {
    const { controller, issued, held } = harness();
    await controller.acquire();
    await controller.acquire();
    issued[0].dropByOs();
    expect(held.at(-1)).toBe(true);
  });

  it('the OS dropping the current lock (page hidden) says so; the next return holds it again', async () => {
    const { controller, issued, held } = harness();
    await controller.acquire();
    issued[0].dropByOs();
    expect(held.at(-1)).toBe(false);
    await controller.acquire();
    expect(held.at(-1)).toBe(true);
  });

  it('stopping (finish, discard, leaving) releases it; a lock arriving after stop goes straight back', async () => {
    const { controller, issued, held } = harness();
    await controller.acquire();
    controller.stop();
    expect(issued[0].released).toBe(1);
    expect(held.at(-1)).toBe(false);
    await controller.acquire();
    expect(issued).toHaveLength(1);
  });

  it('a refused request is no error — just not held', async () => {
    const { controller, held, failOnce } = harness();
    failOnce();
    await expect(controller.acquire()).resolves.toBeUndefined();
    expect(held.at(-1)).toBe(false);
  });
});

describe('every session keeps the screen on through the one hook', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('the recorder (activities, sport sessions, the round timer) and the live workout', () => {
    expect(read('src/components/activities/record/RecordingEngineHost.tsx')).toMatch(/useWakeLock\(!!running\)/);
    // The EFFECTIVE mode (Training fixes PR 4): a finished workout is in review the moment Finish lands, even before a reload.
    expect(read('src/components/workouts/WorkoutEditorScreen.tsx')).toMatch(/useWakeLock\(effectiveMode === 'live' && phase === 'editing'\)/);
  });
});
