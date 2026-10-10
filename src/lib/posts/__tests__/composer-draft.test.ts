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

  it('golf rides along shape-checked and alone keeps a draft non-empty (G1)', () => {
    const golf = { sharedRoundDetails: { courseName: 'Eagle Creek' }, playerScores: [] };
    const withGolf = JSON.stringify({ v: 1, savedAt: NOW, caption: '', golf });
    const parsed = parseComposerDraft(withGolf, NOW);
    expect(parsed?.golf).toEqual(golf); // golf-only draft survives
    // Malformed golf (no sharedRoundDetails object) is dropped, and with
    // nothing else the whole draft reads empty.
    const badGolf = JSON.stringify({ v: 1, savedAt: NOW, caption: '', golf: { playerScores: [] } });
    expect(parseComposerDraft(badGolf, NOW)).toBeNull();
    const golfString = JSON.stringify({ v: 1, savedAt: NOW, caption: 'hi', golf: 'nope' });
    expect(parseComposerDraft(golfString, NOW)?.golf).toBeUndefined();
  });

  it('isEmptyComposerDraft ignores whitespace captions', () => {
    expect(
      isEmptyComposerDraft({ postType: 'general', caption: '  ', hashtags: [], tags: [], visibility: 'public' })
    ).toBe(true);
  });

  // Maintenance pass, Oct 10 2026: captured media waits in the device stash;
  // the draft only counts it, so a media-only post is offered back too.
  it('a media count alone keeps a draft, clamped and integer; zero or junk is no media', () => {
    const mediaOnly = JSON.stringify({ v: 1, savedAt: NOW, caption: '', mediaCount: 2 });
    expect(parseComposerDraft(mediaOnly, NOW)?.mediaCount).toBe(2);
    expect(parseComposerDraft(JSON.stringify({ v: 1, savedAt: NOW, caption: 'x', mediaCount: 99.7 }), NOW)?.mediaCount).toBe(10);
    expect(parseComposerDraft(JSON.stringify({ v: 1, savedAt: NOW, caption: '', mediaCount: 0 }), NOW)).toBeNull();
    expect(parseComposerDraft(JSON.stringify({ v: 1, savedAt: NOW, caption: 'x', mediaCount: '3' }), NOW)?.mediaCount).toBeUndefined();
    expect(isEmptyComposerDraft({ postType: 'general', caption: '', hashtags: [], tags: [], visibility: 'public', mediaCount: 1 })).toBe(false);
  });
});
