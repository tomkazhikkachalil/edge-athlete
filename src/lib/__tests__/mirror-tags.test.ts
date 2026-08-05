import { describe, it, expect } from 'vitest';
import { deriveMirrorPostTags } from '../group-posts/mirror-tags';

const AUTHOR = 'author-id';

const p = (profile_id: string, status = 'confirmed') => ({ profile_id, status });

describe('deriveMirrorPostTags', () => {
  it('returns participants excluding the author', () => {
    expect(deriveMirrorPostTags([p(AUTHOR), p('a'), p('b')], AUTHOR)).toEqual(['a', 'b']);
  });

  it('dedupes participant ids', () => {
    expect(deriveMirrorPostTags([p('a'), p('a'), p('b')], AUTHOR)).toEqual(['a', 'b']);
  });

  it('excludes declined participants', () => {
    expect(deriveMirrorPostTags([p('a'), p('b', 'declined')], AUTHOR)).toEqual(['a']);
  });

  it('keeps pending/maybe participants (only an explicit decline excludes)', () => {
    expect(deriveMirrorPostTags([p('a', 'pending'), p('b', 'maybe')], AUTHOR)).toEqual(['a', 'b']);
  });

  it('excludes athletes who untagged themselves', () => {
    expect(deriveMirrorPostTags([p('a'), p('b')], AUTHOR, ['b'])).toEqual(['a']);
  });

  it('skips empty profile ids', () => {
    expect(deriveMirrorPostTags([p(''), p('a')], AUTHOR)).toEqual(['a']);
  });

  it('returns [] for an author-only round', () => {
    expect(deriveMirrorPostTags([p(AUTHOR)], AUTHOR)).toEqual([]);
  });

  it('returns [] for no participants', () => {
    expect(deriveMirrorPostTags([], AUTHOR)).toEqual([]);
  });
});
