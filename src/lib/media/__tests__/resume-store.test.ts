import { describe, it, expect } from 'vitest';
import { clearResumeEntry, readResumeEntry, resumeStorageKey, writeResumeEntry, type StorageLike } from '../resume-store';

// Videos program Phase 2 (Nov 5 2026): where a resumable upload stopped,
// over an injected storage — fail-open everywhere.

const mem = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: k => { map.delete(k); } };
};
const file = { size: 10, type: 'video/mp4' };
const entry = { uploadUrl: 'https://abc.supabase.co/u/1', path: 'incoming/o/i.mp4', token: 't', size: 10, type: 'video/mp4', savedAt: 1_000 };

describe('resume-store', () => {
  it('writes under the prefixed key and reads the same file back inside the TTL', () => {
    const s = mem();
    writeResumeEntry(s, 'composer:abc', entry);
    expect(s.map.has(resumeStorageKey('composer:abc'))).toBe(true);
    expect(readResumeEntry(s, 'composer:abc', file, 2_000)).toEqual(entry);
    clearResumeEntry(s, 'composer:abc');
    expect(readResumeEntry(s, 'composer:abc', file, 2_000)).toBeNull();
  });
  it('a stale, foreign or malformed entry is dropped on read', () => {
    const s = mem();
    writeResumeEntry(s, 'k', entry);
    expect(readResumeEntry(s, 'k', { size: 99, type: 'video/mp4' }, 2_000)).toBeNull();
    expect(s.map.size).toBe(0);
    s.setItem(resumeStorageKey('k'), '{not json');
    expect(readResumeEntry(s, 'k', file, 2_000)).toBeNull();
    s.setItem(resumeStorageKey('k'), JSON.stringify({ hello: 1 }));
    expect(readResumeEntry(s, 'k', file, 2_000)).toBeNull();
  });
  it('no storage, or a storage that throws, means start over — never an error', () => {
    expect(readResumeEntry(null, 'k', file, 1)).toBeNull();
    expect(() => writeResumeEntry(null, 'k', entry)).not.toThrow();
    expect(() => clearResumeEntry(null, 'k')).not.toThrow();
    const broken: StorageLike = { getItem: () => { throw new Error('private mode'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('x'); } };
    expect(readResumeEntry(broken, 'k', file, 1)).toBeNull();
    expect(() => writeResumeEntry(broken, 'k', entry)).not.toThrow();
    expect(() => clearResumeEntry(broken, 'k')).not.toThrow();
  });
});
