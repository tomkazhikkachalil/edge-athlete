import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { loadDraft, saveDraft } from '../drafts';

// Node environment (no jsdom dep): a minimal in-memory localStorage on a
// window stub is all drafts.ts touches.
const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = { localStorage: localStorageStub };
afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window;
});

describe('chat drafts', () => {
  beforeEach(() => {
    store.clear();
  });

  it('round-trips a draft per conversation', () => {
    saveDraft('conv-1', 'hello th');
    saveDraft('conv-2', 'other');
    expect(loadDraft('conv-1')).toBe('hello th');
    expect(loadDraft('conv-2')).toBe('other');
  });

  it('empty text removes the draft', () => {
    saveDraft('conv-1', 'hello');
    saveDraft('conv-1', '');
    expect(loadDraft('conv-1')).toBe('');
    expect(store.has('ea:chat-draft:v1:conv-1')).toBe(false);
  });

  it('expired drafts are dropped', () => {
    store.set(
      'ea:chat-draft:v1:conv-1',
      JSON.stringify({ v: 1, savedAt: Date.now() - 49 * 60 * 60 * 1000, text: 'old' })
    );
    expect(loadDraft('conv-1')).toBe('');
  });

  it('wrong versions and garbage are ignored', () => {
    store.set('ea:chat-draft:v1:conv-1', 'garbage');
    expect(loadDraft('conv-1')).toBe('');
    store.set('ea:chat-draft:v1:conv-2', JSON.stringify({ v: 9, text: 'x', savedAt: Date.now() }));
    expect(loadDraft('conv-2')).toBe('');
  });
});
