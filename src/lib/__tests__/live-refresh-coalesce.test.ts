import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  REFRESH_COALESCE_MS,
  REFRESH_FLOOR_MS,
  REFRESH_JITTER_MS,
  refreshDelayMs,
} from '../golf/round-access';

// Scale round 2 (Nov 7 2026): fix 1 bounded DELIVERY of score events to the
// round; every delivered event was still one scorecard refetch per viewer.
// A realtime event now SCHEDULES a refresh through refreshDelayMs — a burst
// is one fetch, N spectators spread over the window, and no scheduled fetch
// lands within the floor of the last refresh of any kind.

describe('refreshDelayMs', () => {
  it('an event waits the coalescing window plus jitter', () => {
    expect(refreshDelayMs(0)).toBe(REFRESH_COALESCE_MS);
    expect(refreshDelayMs(0.5)).toBe(REFRESH_COALESCE_MS + Math.floor(0.5 * REFRESH_JITTER_MS));
    expect(refreshDelayMs(0.999_999)).toBeLessThan(REFRESH_COALESCE_MS + REFRESH_JITTER_MS);
    expect(refreshDelayMs(1)).toBeLessThan(REFRESH_COALESCE_MS + REFRESH_JITTER_MS); // clamped below 1
  });
  it('never lands within the floor of the last refresh', () => {
    // Refreshed 200 ms ago: the floor (3 s − 0.2 s = 2.8 s) beats the window (1.5 s).
    expect(refreshDelayMs(0, 200)).toBe(REFRESH_FLOOR_MS - 200);
    // Refreshed long ago: the window alone.
    expect(refreshDelayMs(0, 60_000)).toBe(REFRESH_COALESCE_MS);
    expect(refreshDelayMs(0)).toBe(REFRESH_COALESCE_MS); // never refreshed
    // The window with jitter can exceed the floor's remainder — the larger wins.
    expect(refreshDelayMs(0.999, 1_000)).toBe(REFRESH_COALESCE_MS + Math.floor(0.999 * REFRESH_JITTER_MS));
  });
  it('tolerates bad inputs (NaN random, negative or infinite since)', () => {
    expect(refreshDelayMs(Number.NaN)).toBe(REFRESH_COALESCE_MS);
    expect(refreshDelayMs(-1, -5)).toBe(REFRESH_FLOOR_MS);
    expect(refreshDelayMs(0, Number.NaN)).toBe(REFRESH_COALESCE_MS);
  });
  it('the numbers: a 1.5 s window, 1.5 s of jitter, a 3 s floor', () => {
    expect(REFRESH_COALESCE_MS).toBe(1_500);
    expect(REFRESH_JITTER_MS).toBe(1_500);
    expect(REFRESH_FLOOR_MS).toBe(3_000);
  });
});

describe('useSharedRound: realtime events schedule, the imperative refresh stays immediate', () => {
  const hook = fs.readFileSync(path.join(process.cwd(), 'src/hooks/useSharedRound.ts'), 'utf8');
  it('every realtime handler calls scheduleRefresh(), none calls refresh() directly', () => {
    const effect = hook.slice(hook.indexOf("setConnectionState('connecting');"), hook.indexOf('}, [enabled, groupPostId, refresh, retryNonce, rosterKey]);'));
    expect(effect).toContain('const scheduleRefresh = () => {');
    expect(effect).toContain('refreshDelayMs(Math.random(), since)');
    // The scores handler (two arms), the group_posts status flip, the roster, the resubscribe catch-up.
    expect(effect.match(/scheduleRefresh\(\);/g)?.length).toBe(5);
    // No direct refresh() in the effect: the scheduled one fires the LATEST
    // refresh through a ref (the timer outlives the effect that armed it).
    const direct = effect.match(/^\s*refresh\(\);/gm) ?? [];
    expect(direct.length).toBe(0);
    expect(effect).toMatch(/pendingRefreshRef\.current = null;\s*refreshRef\.current\(\);/);
  });
  it('a resubscribe keeps the pending refresh and catches up its join gap; the round change clears it', () => {
    const effect = hook.slice(hook.indexOf("setConnectionState('connecting');"), hook.indexOf('}, [enabled, groupPostId, refresh, retryNonce, rosterKey]);'));
    expect(effect).not.toContain('clearTimeout(pendingRefreshRef.current)');
    // One catch-up on a SUBSCRIBED that is not the round's first.
    expect(effect).toMatch(/if \(subscribedRoundRef\.current === groupPostId\) scheduleRefresh\(\);\s*subscribedRoundRef\.current = groupPostId;/);
    // The clearing effect is keyed on the round alone.
    expect(hook).toMatch(/subscribedRoundRef\.current = null;\s*return \(\) => \{\s*if \(pendingRefreshRef\.current\) \{\s*clearTimeout\(pendingRefreshRef\.current\);\s*pendingRefreshRef\.current = null;\s*\}\s*\};\s*\}, \[enabled, groupPostId\]\);/);
    expect(hook).toContain('}, [enabled, groupPostId, refresh, retryNonce, rosterKey]);');
  });
  it('every refresh stamps the floor', () => {
    expect(hook).toMatch(/const refresh = useCallback\(async \(\): Promise<boolean> => \{\s*lastRefreshAtRef\.current = Date\.now\(\);/);
  });
});

describe('a seed the caller just fetched is the sync (the live page opened with ONE scorecard read)', () => {
  const hook = fs.readFileSync(path.join(process.cwd(), 'src/hooks/useSharedRound.ts'), 'utf8');
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/(app)/live/[groupPostId]/page.tsx'), 'utf8');
  it('the hook skips its enable-time refresh within SEED_FRESH_MS of initialFreshAt and starts the floor there', () => {
    expect(hook).toContain('const SEED_FRESH_MS = 5_000;');
    expect(hook).toMatch(/if \(initialFreshAt && Date\.now\(\) - initialFreshAt < SEED_FRESH_MS\) \{\s*(\/\/[^\n]*\n\s*)?lastRefreshAtRef\.current = initialFreshAt;\s*return;\s*\}\s*(\/\/[^\n]*\n\s*)?refresh\(\);\s*\}, \[enabled, refresh, initialFreshAt\]\);/);
  });
  it('the live page passes the time of its own read; a feed card passes nothing and is synced once', () => {
    expect(page).toContain('setInitialAt(Date.now());');
    expect(page).toContain('initialFreshAt: initialAt,');
    const card = fs.readFileSync(path.join(process.cwd(), 'src/components/PostCard.tsx'), 'utf8');
    expect(card).not.toContain('initialFreshAt');
  });
});
