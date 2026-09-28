import { describe, expect, it } from 'vitest';
import { activeBanner } from '../banner';

const today = '2026-09-27';

describe('activeBanner', () => {
  it('nothing → no band', () => {
    expect(activeBanner({}, [], today)).toBeNull();
  });

  it('the standing hero notice shows through its end date, inclusive', () => {
    expect(activeBanner({ notice: 'Cart path only' }, [], today)).toMatchObject({ text: 'Cart path only' });
    expect(activeBanner({ notice: 'Cart path only', noticeUntil: today }, [], today)).toMatchObject({ text: 'Cart path only' });
    expect(activeBanner({ notice: 'Cart path only', noticeUntil: '2026-09-26' }, [], today)).toBeNull();
  });

  it('an active announcement beats the standing notice; the newest active one wins', () => {
    const notices = [
      { title: 'Games cancelled tonight', noticeUntil: '2026-09-28' },
      { title: 'Older', noticeUntil: '2026-10-30' },
    ];
    expect(activeBanner({ notice: 'Cart path only' }, notices, today)).toMatchObject({ text: 'Games cancelled tonight', tone: 'warning', href: null });
  });

  it('an expired announcement falls back to the standing notice (or nothing)', () => {
    const expired = [{ title: 'Yesterday only', noticeUntil: '2026-09-26' }];
    expect(activeBanner({ notice: 'Cart path only' }, expired, today)).toMatchObject({ text: 'Cart path only' });
    expect(activeBanner({}, expired, today)).toBeNull();
  });

  it('an announcement without an end date never reaches the band', () => {
    expect(activeBanner({}, [{ title: 'No date', noticeUntil: null }], today)).toBeNull();
  });

  it('L4: the standing notice carries its tone and link; the default tone is warning', () => {
    expect(activeBanner({ notice: 'Fields closed', noticeTone: 'alert', noticeHref: 'https://example.com/fields' }, [], today)).toEqual({
      text: 'Fields closed',
      tone: 'alert',
      href: 'https://example.com/fields',
    });
    expect(activeBanner({ notice: 'Picture day Saturday' }, [], today)).toEqual({ text: 'Picture day Saturday', tone: 'warning', href: null });
  });

  it('A1: a live news post shown as a banner leads the band and links to the post', () => {
    const notices = [{ title: 'An announcement', noticeUntil: '2026-10-01' }];
    expect(activeBanner({ notice: 'Standing' }, notices, today, { title: 'Games cancelled', href: '/org/x/news/games-cancelled' })).toEqual({
      text: 'Games cancelled',
      tone: 'warning',
      href: '/org/x/news/games-cancelled',
    });
    expect(activeBanner({ notice: 'Standing' }, notices, today, null)).toMatchObject({ text: 'An announcement' });
  });
});
