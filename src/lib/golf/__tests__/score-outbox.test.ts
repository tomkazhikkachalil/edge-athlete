import { describe, expect, it } from 'vitest';
import { backoffMs, cellState, classifyResponse, markEntry, nextToFlush, overlayOutbox, parseOutbox, removeEntry, serializeOutbox, upsertEntry, type OutboxEntry } from '../score-outbox';

const base = { participantId: 'p1', holeNumber: 1, strokes: 4, putts: 2, fairwayHit: null, greenInRegulation: null, expectedUpdatedAt: '2026-09-16T10:00:00Z' };

describe('the score outbox', () => {
  it('is a set of desired states: a second commit for the same hole replaces the first and restarts it', () => {
    let e = upsertEntry([], base, 1000);
    e = markEntry(e, 'p1', 1, { attempts: 3, state: 'error', error: 'x' });
    e = upsertEntry(e, { ...base, strokes: 5 }, 2000);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ strokes: 5, attempts: 0, state: 'pending', queuedAt: 2000 });
    expect(e[0].error).toBeUndefined();
    e = upsertEntry(e, { ...base, holeNumber: 2 }, 3000);
    expect(removeEntry(e, 'p1', 1).map(x => x.holeNumber)).toEqual([2]);
  });
  it('round-trips through storage, refuses another round or an expired box', () => {
    const entries = upsertEntry([], base, 1000);
    const raw = serializeOutbox('gp', entries, 1000);
    expect(parseOutbox(raw, 'gp', 2000)).toEqual(entries);
    expect(parseOutbox(raw, 'other', 2000)).toEqual([]);
    expect(parseOutbox(raw, 'gp', 1000 + 49 * 3600 * 1000)).toEqual([]);
    expect(parseOutbox('{', 'gp')).toEqual([]);
  });
  it('overlays pending values on the server card without touching other players', () => {
    const server = [{ hole_number: 1, strokes: 6, putts: 3 }];
    const entries = upsertEntry(upsertEntry([], base), { ...base, holeNumber: 2, strokes: 3, putts: 1 });
    const mine = overlayOutbox(server, entries, 'p1');
    expect(mine.map(h => [h.hole_number, h.strokes])).toEqual([[1, 4], [2, 3]]);
    expect(overlayOutbox(server, entries, 'p2')).toBe(server);
    expect(cellState(entries, 'p1', 2)).toBe('pending');
    expect(cellState(entries, 'p1', 9)).toBe('saved');
  });
  it('classifies responses: network / 5xx / 429 keep, 409 conflict, other 4xx drop, 2xx done; backoff doubles to a minute', () => {
    expect([0, 201, 409, 400, 403, 429, 500].map(classifyResponse)).toEqual(['keep', 'done', 'conflict', 'drop', 'drop', 'keep', 'keep']);
    expect([1, 2, 3, 10].map(backoffMs)).toEqual([2000, 4000, 8000, 60000]);
  });
  it('flushes in queue order, one due pending entry at a time; conflicts and errors wait for the player', () => {
    const a: OutboxEntry = { ...base, queuedAt: 1, attempts: 0, state: 'pending' };
    const b: OutboxEntry = { ...base, holeNumber: 2, queuedAt: 2, attempts: 0, state: 'pending' };
    const c: OutboxEntry = { ...base, holeNumber: 3, queuedAt: 3, attempts: 0, state: 'conflict' };
    expect(nextToFlush([b, a, c], 10)).toBe(a);
    const retried: OutboxEntry = { ...a, attempts: 1, queuedAt: 10_000 };
    expect(nextToFlush([retried, c], 10_500)).toBeNull(); // 2 s backoff not yet due
    expect(nextToFlush([retried, c], 12_500)).toBe(retried);
    expect(nextToFlush([c], 99)).toBeNull();
  });
});
