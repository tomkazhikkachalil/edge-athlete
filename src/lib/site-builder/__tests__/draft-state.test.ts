import { describe, expect, it } from 'vitest';
import { adoptRev, beginSave, chipFor, initialDraftState, publishBlocker, settleSave, shouldRetryAfterRatelimit, shouldSave } from '../draft-state';
import type { SiteLayout } from '../layout';

// Hardening H5: the autosave's decisions, without a browser. Layouts are
// compared by IDENTITY (the editor's history hands out new objects per
// edit), so each distinct layout here is one constant.
const made = new Map<number, SiteLayout>();
const L = (n: number): SiteLayout => {
  const hit = made.get(n);
  if (hit) return hit;
  const l: SiteLayout = { version: 1, cols: 12, widgets: [] };
  made.set(n, l);
  return l;
};

describe('draft-state', () => {
  it('no overlapping saves: while one is in flight the next edit waits; the settle re-arms it', () => {
    let s = initialDraftState(L(0), 3);
    expect(shouldSave(s, L(0))).toBe(false);
    expect(shouldSave(s, L(1))).toBe(true);
    s = beginSave(s, L(1));
    expect(s.status).toBe('saving');
    expect(shouldSave(s, L(2))).toBe(false); // in flight → wait
    s = settleSave(s, s.seq, { kind: 'ok', rev: 4 });
    expect(s).toMatchObject({ status: 'saved', rev: 4, inFlight: null });
    expect(s.saved).toBe(L(1)); // saved = the layout SENT
    expect(shouldSave(s, L(2))).toBe(true); // the pending edit saves next
  });

  it('a stale response never moves anything: only the in-flight seq settles', () => {
    let s = beginSave(initialDraftState(L(0), 1), L(1));
    const first = s.seq;
    // A second save started (only possible after a settle in the hook — simulate a stale echo of an older seq).
    s = settleSave(s, first - 1, { kind: 'ok', rev: 99 });
    expect(s.status).toBe('saving');
    expect(s.rev).toBe(1);
    s = settleSave(s, first, { kind: 'ok', rev: 2 });
    expect(s.rev).toBe(2);
    expect(settleSave(s, first, { kind: 'ok', rev: 77 })).toBe(s); // nothing in flight → ignored
  });

  it('saved is the layout that was SENT, so an edit made during the save stays dirty', () => {
    const sent = L(1);
    let s = beginSave(initialDraftState(L(0), 1), sent);
    s = settleSave(s, s.seq, { kind: 'ok', rev: 2 });
    expect(s.saved).toBe(sent);
    expect(shouldSave(s, L(2))).toBe(true);
    expect(shouldSave(s, sent)).toBe(false);
  });

  it('each failure is its own status; invalid carries the issues; offline vs error by connectivity', () => {
    const start = beginSave(initialDraftState(L(0), 1), L(1));
    expect(settleSave(start, start.seq, { kind: 'invalid', issues: [{ id: 'w', message: 'hero: title too long' }] })).toMatchObject({ status: 'invalid', issues: [{ message: 'hero: title too long' }] });
    expect(settleSave(start, start.seq, { kind: 'conflict' }).status).toBe('conflict');
    expect(settleSave(start, start.seq, { kind: 'unsupported' }).status).toBe('unsupported');
    expect(settleSave(start, start.seq, { kind: 'network' }, true).status).toBe('error');
    expect(settleSave(start, start.seq, { kind: 'network' }, false).status).toBe('offline');
    // Nothing moved: the failed layout is still dirty and the rev is untouched.
    const failed = settleSave(start, start.seq, { kind: 'conflict' });
    expect(failed.rev).toBe(1);
    expect(shouldSave(failed, L(1))).toBe(true);
  });

  it('ratelimited: one automatic retry, then wait for the next edit; a success resets the count', () => {
    let s = beginSave(initialDraftState(L(0), 1), L(1));
    s = settleSave(s, s.seq, { kind: 'ratelimited' });
    expect(s).toMatchObject({ status: 'ratelimited', retries: 1 });
    expect(shouldRetryAfterRatelimit(s)).toBe(true);
    s = beginSave(s, L(1));
    s = settleSave(s, s.seq, { kind: 'ratelimited' });
    expect(s.retries).toBe(2);
    expect(shouldRetryAfterRatelimit(s)).toBe(false);
    s = beginSave(s, L(1));
    s = settleSave(s, s.seq, { kind: 'ok', rev: 2 });
    expect(s.retries).toBe(0);
  });

  it('adoptRev only advances', () => {
    const s = initialDraftState(L(0), 5);
    expect(adoptRev(s, 7).rev).toBe(7);
    expect(adoptRev(s, 3).rev).toBe(5);
    expect(adoptRev(s, null).rev).toBe(5);
    expect(adoptRev(initialDraftState(L(0), null), 2).rev).toBe(2);
  });

  it('publishBlocker: every blocking status names what changes it; clean idle/saved may publish', () => {
    const at = (status: Parameters<typeof publishBlocker>[0]['status'], dirty = false, issues: { message: string }[] = []) => publishBlocker({ status, issues }, dirty);
    expect(at('idle')).toBeNull();
    expect(at('saved')).toBeNull();
    expect(at('idle', true)).toMatch(/Saving — one moment/);
    expect(at('saving')).toMatch(/Saving — one moment/);
    expect(at('invalid', true, [{ message: 'hero: title too long' }])).toMatch(/Fix the highlighted section.*title too long/);
    expect(at('conflict', true)).toMatch(/reload/i);
    expect(at('unsupported', true)).toMatch(/180/);
    expect(at('offline', true)).toMatch(/offline/i);
    expect(at('ratelimited', true)).toMatch(/paused/);
    expect(at('error', true)).toMatch(/hasn’t saved/);
    // Never the old wording for a status that never resolves by itself.
    for (const status of ['invalid', 'conflict', 'unsupported', 'offline', 'error'] as const) expect(at(status, true)).not.toMatch(/finish saving/);
  });

  it('chipFor names each state; saved+dirty reads Unsaved', () => {
    expect(chipFor({ status: 'saved', issues: [] }, false).text).toBe('Saved to draft');
    expect(chipFor({ status: 'saved', issues: [] }, true).text).toBe('Unsaved');
    expect(chipFor({ status: 'invalid', issues: [{ message: 'x' }] }, true).text).toContain('x');
    expect(chipFor({ status: 'idle', issues: [] }, false).text).toBe('Draft');
  });
});
