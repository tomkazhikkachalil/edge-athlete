import { describe, expect, it } from 'vitest';
import { activeBanner } from '../banner';

const today = '2026-09-27';

describe('activeBanner', () => {
  it('nothing → no band', () => {
    expect(activeBanner({}, [], today)).toBeNull();
  });

  it('the standing hero notice shows through its end date, inclusive', () => {
    expect(activeBanner({ notice: 'Cart path only' }, [], today)).toBe('Cart path only');
    expect(activeBanner({ notice: 'Cart path only', noticeUntil: today }, [], today)).toBe('Cart path only');
    expect(activeBanner({ notice: 'Cart path only', noticeUntil: '2026-09-26' }, [], today)).toBeNull();
  });

  it('an active announcement beats the standing notice; the newest active one wins', () => {
    const notices = [
      { title: 'Games cancelled tonight', noticeUntil: '2026-09-28' },
      { title: 'Older', noticeUntil: '2026-10-30' },
    ];
    expect(activeBanner({ notice: 'Cart path only' }, notices, today)).toBe('Games cancelled tonight');
  });

  it('an expired announcement falls back to the standing notice (or nothing)', () => {
    const expired = [{ title: 'Yesterday only', noticeUntil: '2026-09-26' }];
    expect(activeBanner({ notice: 'Cart path only' }, expired, today)).toBe('Cart path only');
    expect(activeBanner({}, expired, today)).toBeNull();
  });

  it('an announcement without an end date never reaches the band', () => {
    expect(activeBanner({}, [{ title: 'No date', noticeUntil: null }], today)).toBeNull();
  });
});
