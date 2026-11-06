import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activeHighlightAt,
  clearResumeMs,
  IFRAME_API_SRC,
  markMomentMs,
  nextInPlaylist,
  OPEN_HIGHLIGHT_MS,
  PLAYER_HOST,
  playlistOf,
  readResumeMs,
  RESUME_MIN_MS,
  resumeOffer,
  type StorageLike,
  writeResumeMs,
} from '../player-rules';

const mem = (): StorageLike & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
};

describe('player-rules — zero imports; YouTube hosts only', () => {
  it('imports nothing and names the two hosts the CSP already knows', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/videos/player-rules.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(IFRAME_API_SRC).toBe('https://www.youtube.com/iframe_api');
    expect(PLAYER_HOST).toBe('https://www.youtube-nocookie.com');
  });
});

describe('mark this moment', () => {
  it('seconds → whole milliseconds, never negative, never NaN', () => {
    expect(markMomentMs(90.4)).toBe(90_400);
    expect(markMomentMs(0)).toBe(0);
    expect(markMomentMs(-1)).toBeNull();
    expect(markMomentMs(Number.NaN)).toBeNull();
  });
});

describe('play highlights', () => {
  const hs = [
    { id: 'b', start_ms: 60_000, end_ms: null },
    { id: 'a', start_ms: 10_000, end_ms: 15_000 },
    { id: 'c', start_ms: 120_000, end_ms: 110_000 }, // an end before the start: treated as open
  ];
  it('the list is in time order with a definite end each (an open marker plays 20 s)', () => {
    expect(playlistOf(hs)).toEqual([
      { id: 'a', startMs: 10_000, endMs: 15_000 },
      { id: 'b', startMs: 60_000, endMs: 60_000 + OPEN_HIGHLIGHT_MS },
      { id: 'c', startMs: 120_000, endMs: 120_000 + OPEN_HIGHLIGHT_MS },
    ]);
  });
  it('stay until the end, then the next, then done', () => {
    const list = playlistOf(hs);
    expect(nextInPlaylist(list, 0, 12_000)).toEqual({ action: 'stay' });
    expect(nextInPlaylist(list, 0, 15_000)).toEqual({ action: 'next', index: 1 });
    expect(nextInPlaylist(list, 2, 200_000)).toEqual({ action: 'done' });
    expect(nextInPlaylist(list, 7, 0)).toEqual({ action: 'done' });
  });
  it('the active row follows the playhead: the last marker at or before it', () => {
    expect(activeHighlightAt(hs, 5_000)).toBeNull();
    expect(activeHighlightAt(hs, 10_000)).toBe('a');
    expect(activeHighlightAt(hs, 61_000)).toBe('b');
    expect(activeHighlightAt(hs, 999_000)).toBe('c');
  });
});

describe('resume', () => {
  it('offers a saved position of half a minute or more that is not within the last half minute', () => {
    expect(resumeOffer(RESUME_MIN_MS - 1, null)).toBeNull();
    expect(resumeOffer(90_000, null)).toBe(90_000);
    expect(resumeOffer(90_000, 100_000)).toBeNull(); // the tail
    expect(resumeOffer(90_000, 200_000)).toBe(90_000);
    expect(resumeOffer(null, 200_000)).toBeNull();
  });
  it('the store is fail-open and keyed per video', () => {
    const s = mem();
    writeResumeMs(s, 'abc', 12_345.6);
    expect(s.m.get('ea-video-resume:abc')).toBe('12346');
    expect(readResumeMs(s, 'abc')).toBe(12_346);
    expect(readResumeMs(s, 'other')).toBeNull();
    clearResumeMs(s, 'abc');
    expect(readResumeMs(s, 'abc')).toBeNull();
    expect(readResumeMs(null, 'abc')).toBeNull();
    const throwing: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(readResumeMs(throwing, 'abc')).toBeNull();
    expect(() => writeResumeMs(throwing, 'abc', 1)).not.toThrow();
  });
});
