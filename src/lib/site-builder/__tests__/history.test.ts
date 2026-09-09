import { describe, expect, it } from 'vitest';
import { historyReducer, initialHistory, type History } from '@/components/site-builder/useHistory';

// P6-B: the editor's undo stack, with COALESCING — consecutive commits that
// carry the same key fold into one step (typing a paragraph), while any
// un-keyed commit, undo or redo closes the run. Pure reducer, node-tested.
describe('history reducer', () => {
  const start = initialHistory('a');
  const commit = (s: History<string>, next: string, coalesce?: string) => historyReducer(s, { type: 'commit', next, coalesce });

  it('plain commits push; undo/redo walk the stack', () => {
    let s = commit(start, 'b');
    s = commit(s, 'c');
    expect(s.past).toEqual(['a', 'b']);
    s = historyReducer(s, { type: 'undo' });
    expect(s.present).toBe('b');
    expect(s.future).toEqual(['c']);
    s = historyReducer(s, { type: 'redo' });
    expect(s.present).toBe('c');
    expect(historyReducer(start, { type: 'undo' })).toBe(start);
  });

  it('same-key commits coalesce into ONE undo step', () => {
    let s = commit(start, 'H', 'title');
    s = commit(s, 'He', 'title');
    s = commit(s, 'Hel', 'title');
    expect(s.present).toBe('Hel');
    expect(s.past).toEqual(['a']);
    s = historyReducer(s, { type: 'undo' });
    expect(s.present).toBe('a');
  });

  it('a different key, an un-keyed commit, an undo or a redo closes the run', () => {
    let s = commit(start, 'H', 'title');
    s = commit(s, 'He', 'title');
    s = commit(s, 'x', 'caption');
    expect(s.past).toEqual(['a', 'He']);
    s = commit(s, 'xy', 'caption');
    s = commit(s, 'moved');
    expect(s.past).toEqual(['a', 'He', 'xy']);
    // After a drag, typing the same field again is a NEW step.
    s = commit(s, 'moved+t', 'caption');
    expect(s.past).toEqual(['a', 'He', 'xy', 'moved']);
    s = historyReducer(s, { type: 'undo' });
    s = commit(s, 'again', 'caption');
    expect(s.past).toEqual(['a', 'He', 'xy', 'moved']);
    expect(s.future).toEqual([]);
  });

  it('a coalesced commit still clears the redo branch; replace touches nothing else', () => {
    let s = commit(start, 'b', 'k');
    s = historyReducer(s, { type: 'undo' });
    expect(s.future).toEqual(['b']);
    // Undo closed the run, so this is a fresh keyed step.
    s = commit(s, 'c', 'k');
    expect(s.past).toEqual(['a']);
    expect(s.future).toEqual([]);
    const r = historyReducer(s, { type: 'replace', next: 'server' });
    expect(r.present).toBe('server');
    expect(r.past).toEqual(['a']);
  });

  it('an identical present is a no-op', () => {
    expect(commit(start, 'a')).toBe(start);
  });
});
