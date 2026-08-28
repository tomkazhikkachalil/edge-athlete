import { describe, it, expect } from 'vitest';
import { nextEventPerChild, type NextEventInput } from '../next-event';

const T0 = Date.parse('2026-08-29T12:00:00Z');
const HOUR = 3_600_000;

const ev = (
  id: string,
  childIds: string[],
  startOffsetH: number,
  endOffsetH: number
): NextEventInput => ({
  id,
  title: `event ${id}`,
  starts_at: new Date(T0 + startOffsetH * HOUR).toISOString(),
  ends_at: new Date(T0 + endOffsetH * HOUR).toISOString(),
  all_day: false,
  childIds,
});

describe('nextEventPerChild', () => {
  it('picks the soonest future event per child, fanning a shared event to both', () => {
    const result = nextEventPerChild(
      [ev('later', ['a'], 48, 50), ev('soon', ['a', 'b'], 2, 4)],
      T0
    );
    expect(result.get('a')?.eventId).toBe('soon');
    expect(result.get('b')?.eventId).toBe('soon');
  });

  it('ended events are past; in-progress events still count', () => {
    const result = nextEventPerChild(
      [ev('done', ['a'], -4, -2), ev('running', ['a'], -1, 1)],
      T0
    );
    expect(result.get('a')?.eventId).toBe('running');
  });

  it('same start ties break on event id, never input order', () => {
    const a = nextEventPerChild([ev('zz', ['a'], 2, 4), ev('aa', ['a'], 2, 4)], T0);
    const b = nextEventPerChild([ev('aa', ['a'], 2, 4), ev('zz', ['a'], 2, 4)], T0);
    expect(a.get('a')?.eventId).toBe('aa');
    expect(b.get('a')?.eventId).toBe('aa');
  });

  it('empty/null inputs and unparseable rows yield an empty map', () => {
    expect(nextEventPerChild([], T0).size).toBe(0);
    expect(nextEventPerChild(null, T0).size).toBe(0);
    const bad: NextEventInput = {
      id: 'x', title: 'x', starts_at: 'nope', ends_at: 'nope', all_day: false, childIds: ['a'],
    };
    expect(nextEventPerChild([bad], T0).size).toBe(0);
  });

  it('a child with only past events gets no entry', () => {
    const result = nextEventPerChild([ev('old', ['b'], -10, -8)], T0);
    expect(result.has('b')).toBe(false);
  });
});
