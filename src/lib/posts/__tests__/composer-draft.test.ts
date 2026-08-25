import { describe, it, expect } from 'vitest';
import {
  parseComposerDraft,
  isEmptyComposerDraft,
  COMPOSER_DRAFT_TTL_MS,
} from '../composer-draft';

const NOW = 1_756_000_000_000;

describe('parseComposerDraft', () => {
  it('round-trips a draft', () => {
    const raw = JSON.stringify({
      v: 1,
      savedAt: NOW - 1000,
      postType: 'golf',
      caption: 'Great day at Eagle Creek',
      hashtags: ['#golf'],
      tags: ['round'],
      visibility: 'private',
    });
    expect(parseComposerDraft(raw, NOW)).toEqual({
      postType: 'golf',
      caption: 'Great day at Eagle Creek',
      hashtags: ['#golf'],
      tags: ['round'],
      visibility: 'private',
    });
  });

  it('expires after the TTL and rejects wrong versions/garbage', () => {
    const stale = JSON.stringify({ v: 1, savedAt: NOW - COMPOSER_DRAFT_TTL_MS - 1, caption: 'x' });
    expect(parseComposerDraft(stale, NOW)).toBeNull();
    expect(parseComposerDraft('nope', NOW)).toBeNull();
    expect(parseComposerDraft(JSON.stringify({ v: 2, savedAt: NOW, caption: 'x' }), NOW)).toBeNull();
    expect(parseComposerDraft(null, NOW)).toBeNull();
  });

  it('defaults malformed fields and drops empty drafts entirely', () => {
    const junk = JSON.stringify({ v: 1, savedAt: NOW, caption: 7, hashtags: 'x', visibility: 'weird' });
    expect(parseComposerDraft(junk, NOW)).toBeNull(); // everything defaulted → empty
    const partial = JSON.stringify({ v: 1, savedAt: NOW, caption: 'hi', hashtags: [1, '#a'] });
    expect(parseComposerDraft(partial, NOW)).toEqual({
      postType: 'general',
      caption: 'hi',
      hashtags: ['#a'],
      tags: [],
      visibility: 'public',
    });
  });

  it('isEmptyComposerDraft ignores whitespace captions', () => {
    expect(
      isEmptyComposerDraft({ postType: 'general', caption: '  ', hashtags: [], tags: [], visibility: 'public' })
    ).toBe(true);
  });
});
