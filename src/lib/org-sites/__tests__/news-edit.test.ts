import { describe, expect, it } from 'vitest';
import { snapshotAfter, visibilityPatch } from '../news-edit';

type B = { type: 'paragraph'; text: string };
const blocks: B[] = [{ type: 'paragraph', text: 'Hello' }];

describe('visibilityPatch', () => {
  it('a dirty news publish carries the unsaved title and body with it', () => {
    expect(visibilityPatch('news', 'public', { dirty: true, title: '  Opening day ', blocks })).toEqual({
      publish: true,
      title: 'Opening day',
      body: blocks,
    });
  });

  it('a clean toggle sends the state change alone', () => {
    expect(visibilityPatch('news', 'draft', { dirty: false, title: 'x', blocks })).toEqual({ publish: false });
    expect(visibilityPatch('page', 'public', { dirty: false, title: 'x', blocks })).toEqual({ visibility: 'public' });
  });

  it('a page speaks visibility, never publish', () => {
    const p = visibilityPatch('page', 'draft', { dirty: true, title: 'About', blocks });
    expect(p).toEqual({ visibility: 'draft', title: 'About', body: blocks });
    expect('publish' in p).toBe(false);
  });
});

describe('snapshotAfter', () => {
  it('dirty → the written content becomes the saved snapshot (the form is clean again)', () => {
    expect(snapshotAfter({ dirty: true, title: ' T ', blocks }, 'old')).toBe(JSON.stringify({ title: 'T', blocks }));
  });
  it('clean → the saved snapshot is unchanged', () => {
    expect(snapshotAfter({ dirty: false, title: 'T', blocks }, 'old')).toBe('old');
  });
});
