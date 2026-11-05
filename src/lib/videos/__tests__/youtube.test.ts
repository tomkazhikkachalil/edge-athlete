import { describe, expect, it } from 'vitest';
import { embedSrcAt, parseYouTubeLink, parseYouTubeTime, thumbUrl, watchUrl, YOUTUBE_EMBED_HOST } from '@/lib/videos/youtube';
import { EMBED_FRAME_HOSTS } from '@/lib/site-builder/embeds';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeLink — every link form a person pastes', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, null],
    [`https://youtube.com/watch?v=${ID}&list=PL123`, null],
    [`https://m.youtube.com/watch?v=${ID}`, null],
    [`https://youtu.be/${ID}`, null],
    [`https://youtu.be/${ID}?si=abc`, null],
    [`https://www.youtube.com/shorts/${ID}`, null],
    [`https://www.youtube.com/live/${ID}`, null],
    [`https://www.youtube.com/embed/${ID}`, null],
    [`https://www.youtube-nocookie.com/embed/${ID}`, null],
    [`  https://www.youtube.com/watch?v=${ID}  `, null],
    [`https://www.youtube.com/watch?v=${ID}&t=90`, 90_000],
    [`https://www.youtube.com/watch?v=${ID}&t=90s`, 90_000],
    [`https://www.youtube.com/watch?v=${ID}&t=1m30s`, 90_000],
    [`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`, 3_723_000],
    [`https://youtu.be/${ID}?t=125`, 125_000],
    [`https://www.youtube.com/watch?v=${ID}&start=60`, 60_000],
    [`https://www.youtube.com/watch?v=${ID}#t=2m`, 120_000],
  ])('%s → the id and its timestamp', (url, startMs) => {
    expect(parseYouTubeLink(url)).toEqual({ id: ID, startMs });
  });

  it.each([
    'not a link',
    'https://vimeo.com/123456789',
    'https://www.youtube.com/',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UCabc',
    'ftp://youtu.be/dQw4w9WgXcQ',
    `javascript:alert(1)//youtu.be/${ID}`,
    '',
  ])('%s → null', url => {
    expect(parseYouTubeLink(url)).toBeNull();
  });

  it('a junk timestamp leaves the id and no start', () => {
    expect(parseYouTubeLink(`https://www.youtube.com/watch?v=${ID}&t=abc`)).toEqual({ id: ID, startMs: null });
  });
});

describe('parseYouTubeTime', () => {
  it.each([
    ['90', 90_000],
    ['90s', 90_000],
    ['1m', 60_000],
    ['1m30s', 90_000],
    ['1h', 3_600_000],
    ['1h2m3s', 3_723_000],
    ['0', 0],
  ])('%s → %d ms', (raw, ms) => expect(parseYouTubeTime(raw)).toBe(ms));
  it.each(['', ' ', 'abc', '1x', '-5', '1:30', null, undefined])('%s → null', raw => expect(parseYouTubeTime(raw as string)).toBeNull());
});

describe('the URLs are rebuilt from the id, never from the person\'s text', () => {
  it('watchUrl is the canonical watch link', () => {
    expect(watchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
  it('embedSrcAt targets the privacy-enhanced host the CSP admits', () => {
    expect(YOUTUBE_EMBED_HOST).toBe(EMBED_FRAME_HOSTS[0]);
    expect(embedSrcAt(ID, null)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
  });
  it('a highlight start is whole seconds + autoplay; zero or junk is the plain frame', () => {
    expect(embedSrcAt(ID, 90_500)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0&start=90&autoplay=1`);
    expect(embedSrcAt(ID, 0)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
    expect(embedSrcAt(ID, Number.NaN)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
  });
  it('thumbUrl is the i.ytimg.com poster (img-src https:)', () => {
    expect(thumbUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });
});
