import { describe, expect, it } from 'vitest';
import { canPost, captionTone, firstNameOf, formatHashtag, isEmptyPost, slideWords, splitHashtagInput, tagRowLabel, withHashtag } from '@/lib/posts/composer-rules';
import { isCover, moveToCover } from '@/lib/media/cover';

const base = { mediaCount: 0, caption: '', hasActivity: false, uploading: false, tooLongVideo: false };

describe('what may be posted (X2)', () => {
  it('an empty post cannot be posted', () => {
    expect(canPost(base)).toBe(false);
    expect(canPost({ ...base, caption: '   ' })).toBe(false);
    expect(isEmptyPost(base)).toBe(true);
  });
  it('media, a caption or an attached activity is enough, each alone (A3)', () => {
    expect(canPost({ ...base, mediaCount: 1 })).toBe(true);
    expect(canPost({ ...base, caption: 'hi' })).toBe(true);
    expect(canPost({ ...base, hasActivity: true })).toBe(true);
    expect(canPost({ ...base, hasStats: true })).toBe(true);
  });
  it('waits while a file uploads or a video is too long', () => {
    expect(canPost({ ...base, mediaCount: 1, uploading: true })).toBe(false);
    expect(canPost({ ...base, mediaCount: 1, tooLongVideo: true })).toBe(false);
  });
});

describe('the slide\'s words (X1)', () => {
  it('never names what is missing', () => {
    expect(slideWords({ uploading: false, posting: false, posted: false })).toBe('Slide to post');
    expect(slideWords({ uploading: true, posting: false, posted: false })).toBe('Uploading');
    expect(slideWords({ uploading: true, posting: true, posted: false })).toBe('Posting');
    expect(slideWords({ uploading: false, posting: true, posted: true })).toBe('Posted');
  });
});

describe('the caption counter', () => {
  it('is quiet when empty, good in range, a warning in the last 50, bad at the limit', () => {
    expect(captionTone(0, 500)).toBe('empty');
    expect(captionTone(1, 500)).toBe('ok');
    expect(captionTone(450, 500)).toBe('ok');
    expect(captionTone(451, 500)).toBe('warn');
    expect(captionTone(499, 500)).toBe('warn');
    expect(captionTone(500, 500)).toBe('bad');
  });
});

describe('hashtags', () => {
  it('are stored with one leading #', () => {
    expect(formatHashtag('golf')).toBe('#golf');
    expect(formatHashtag('#golf')).toBe('#golf');
    expect(formatHashtag('##golf ')).toBe('#golf');
    expect(formatHashtag(' # ')).toBe('');
  });
  it('a space or a comma ends a tag; the rest stays in the field', () => {
    expect(splitHashtagInput('gol')).toEqual({ tags: [], rest: 'gol' });
    expect(splitHashtagInput('golf ')).toEqual({ tags: ['#golf'], rest: '' });
    expect(splitHashtagInput('golf,ru')).toEqual({ tags: ['#golf'], rest: 'ru' });
    expect(splitHashtagInput('#a, #b c')).toEqual({ tags: ['#a', '#b'], rest: 'c' });
    expect(splitHashtagInput(' ')).toEqual({ tags: [], rest: '' });
  });
  it('are never added twice or past the limit', () => {
    expect(withHashtag(['#a'], 'a', 10)).toEqual(['#a']);
    expect(withHashtag(['#a'], 'b', 10)).toEqual(['#a', '#b']);
    expect(withHashtag(['#a'], 'b', 1)).toEqual(['#a']);
    expect(withHashtag([], '  ', 10)).toEqual([]);
  });
});

describe('the Tag people row', () => {
  it('reads first names, two at most, then how many more', () => {
    expect(tagRowLabel([])).toBe('Tag people');
    expect(tagRowLabel(['Alex Morgan'])).toBe('Alex');
    expect(tagRowLabel(['Alex Morgan', 'Sam Lee'])).toBe('Alex, Sam');
    expect(tagRowLabel(['Alex Morgan', 'Sam Lee', 'Jo'])).toBe('Alex, Sam +1');
    expect(firstNameOf('  Maria  del Mar ')).toBe('Maria');
  });
});

describe('the cover (A7, A8)', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('Cover moves the item first and keeps the others in order', () => {
    expect(moveToCover(list, 'c').map(i => i.id)).toEqual(['c', 'a', 'b']);
    expect(moveToCover(list, 'b').map(i => i.id)).toEqual(['b', 'a', 'c']);
  });
  it('is the same list when already first or unknown', () => {
    expect(moveToCover(list, 'a')).toBe(list);
    expect(moveToCover(list, 'x')).toBe(list);
  });
  it('the first item is the cover', () => {
    expect(isCover(list, 'a')).toBe(true);
    expect(isCover(list, 'b')).toBe(false);
    expect(isCover([], 'a')).toBe(false);
  });
});
