import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Nov 19 2026 (Tom: a round closed and posted on one device stayed live on
// the other). The screens that HOLD a live thing hear the live signal itself.
const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

describe('the live signal', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined }); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('a burst of signals is one tick, after the spread, to every listener', async () => {
    const store = await import('@/lib/pulse/pulse-store');
    const a = vi.fn();
    const b = vi.fn();
    store.subscribeLiveSignal(a);
    const offB = store.subscribeLiveSignal(b);
    for (let i = 0; i < 5; i++) store.emitLiveSignal();
    vi.advanceTimersByTime(store.LIVE_SIGNAL_DELAY_MS - 1);
    expect(a).not.toHaveBeenCalled();
    vi.advanceTimersByTime(store.LIVE_SIGNAL_JITTER_MS + 2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offB();
    store.emitLiveSignal();
    vi.advanceTimersByTime(store.LIVE_SIGNAL_DELAY_MS + store.LIVE_SIGNAL_JITTER_MS + 1);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('nobody listening: no timer is started', async () => {
    const store = await import('@/lib/pulse/pulse-store');
    store.emitLiveSignal();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a hidden tab is not woken: it catches up when it returns', async () => {
    vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener: () => undefined, removeEventListener: () => undefined });
    const store = await import('@/lib/pulse/pulse-store');
    const a = vi.fn();
    store.subscribeLiveSignal(a);
    store.emitLiveSignal();
    vi.advanceTimersByTime(store.LIVE_SIGNAL_DELAY_MS + store.LIVE_SIGNAL_JITTER_MS + 1);
    expect(a).not.toHaveBeenCalled();
  });
});

describe('who listens', () => {
  it('the one live-now host passes the signal on, beside the pulse fetch', () => {
    const host = read('lib/pulse/PulseHost.tsx');
    expect(host).toMatch(/requestPulse\('signal'\);[\s\S]{0,160}emitLiveSignal\(\);/);
  });
  it('the drafts cache refreshes on the signal and on coming back, only while it holds something in progress', () => {
    const src = read('hooks/useDrafts.ts');
    expect(src).toContain('subscribeLiveSignal(refreshIfHolding)');
    expect(src).toContain("document.addEventListener('visibilitychange', onResume)");
    expect(src).toContain('if (!cached || cached.inProgress.length === 0) return;');
  });
  it('the Live Now list refetches on the signal, past the browser\'s copy', () => {
    const src = read('components/LiveNowStrip.tsx');
    expect(src).toContain('subscribeLiveSignal(() => { if (shouldPoll()) run(true); })');
    expect(src).toContain("force ? { cache: 'no-store' } : undefined");
    expect(src).toContain('offSignal?.();');
  });
  it('the live page closes an open scorer when the round goes from live to final under it, and says so', () => {
    const src = read('app/(app)/live/[groupPostId]/page.tsx');
    expect(src).toContain("if (entry.mode === 'final' && (lastEntryMode === 'score' || lastEntryMode === 'record') && scoringParticipantId) {");
    expect(src).toContain('setScoringParticipantId(null);\n      setFinishedElsewhere(true);');
    expect(src).toContain('data-live-finished-elsewhere=""');
  });
});
