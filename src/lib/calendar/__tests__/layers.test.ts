import { describe, it, expect } from 'vitest';
import {
  ME,
  mergeLayeredEvents,
  filterLayeredEvents,
  personDotClass,
  PERSON_DOT_CLASSES,
  type LayeredEvent,
} from '../layers';
import type { EventListItem } from '@/components/calendar/types';

const ev = (overrides: Partial<EventListItem>): EventListItem =>
  ({
    id: 'e1',
    title: 'Practice',
    starts_at: '2026-09-01T22:00:00.000Z',
    ends_at: '2026-09-01T23:00:00.000Z',
    all_day: false,
    timezone: 'America/New_York',
    category: 'practice',
    status: 'active',
    my_status: 'accepted',
    is_organizer: false,
    series_id: null,
    ...overrides,
  }) as EventListItem;

describe('mergeLayeredEvents', () => {
  it('tags each event with every person whose set carries it, deduped by id', () => {
    const out = mergeLayeredEvents([
      { personId: ME, events: [ev({ id: 'a' })] },
      { personId: 'kid1', events: [ev({ id: 'a' }), ev({ id: 'b' })] },
      { personId: 'kid2', events: [ev({ id: 'b' })] },
    ]);
    const byId = new Map(out.map(e => [e.id, e]));
    expect(byId.get('a')?.personIds).toEqual([ME, 'kid1']);
    expect(byId.get('b')?.personIds).toEqual(['kid1', 'kid2']);
  });

  it("own row wins field-wise: the caller's my_status drives styling", () => {
    const out = mergeLayeredEvents([
      { personId: ME, events: [ev({ id: 'a', my_status: 'accepted' })] },
      { personId: 'kid1', events: [ev({ id: 'a', my_status: 'invited' })] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].my_status).toBe('accepted');
    expect(out[0].personIds).toEqual([ME, 'kid1']);
  });

  it('drops overlay and cancelled items from child sets but keeps the own set whole', () => {
    const overlay = ev({ id: 'act', my_status: undefined });
    const cancelled = ev({ id: 'gone', status: 'cancelled' });
    const out = mergeLayeredEvents([
      { personId: ME, events: [overlay] },
      { personId: 'kid1', events: [ev({ id: 'childact', my_status: undefined }), cancelled] },
    ]);
    expect(out.map(e => e.id)).toEqual(['act']);
  });
});

describe('filterLayeredEvents', () => {
  const events: LayeredEvent[] = [
    { ...ev({ id: 'mine', category: 'general' }), personIds: [ME] },
    { ...ev({ id: 'kidgame', category: 'game' }), personIds: ['kid1'] },
    { ...ev({ id: 'kidpractice', category: 'practice' }), personIds: ['kid1'] },
    { ...ev({ id: 'shared', category: 'game' }), personIds: [ME, 'kid2'] },
  ];

  it('empty selections deactivate both groups', () => {
    expect(
      filterLayeredEvents(events, { people: new Set(), categories: new Set() })
    ).toHaveLength(4);
  });

  it('people group is OR within', () => {
    const out = filterLayeredEvents(events, {
      people: new Set(['kid1', 'kid2']),
      categories: new Set(),
    });
    expect(out.map(e => e.id).sort()).toEqual(['kidgame', 'kidpractice', 'shared']);
  });

  it('people AND category: just one child, just the games', () => {
    const out = filterLayeredEvents(events, {
      people: new Set(['kid1']),
      categories: new Set(['game']),
    });
    expect(out.map(e => e.id)).toEqual(['kidgame']);
  });

  it('events without personIds pass the people group (plain calendars)', () => {
    const bare = [{ ...ev({ id: 'x' }), personIds: [] as string[] }];
    expect(
      filterLayeredEvents(bare, { people: new Set([ME]), categories: new Set() })
    ).toHaveLength(1);
  });
});

describe('personDotClass', () => {
  const roster = ['bbb', 'aaa', 'ccc'];

  it('assigns by sorted position, independent of roster order', () => {
    expect(personDotClass('aaa', roster)).toBe(PERSON_DOT_CLASSES[0]);
    expect(personDotClass('bbb', roster)).toBe(PERSON_DOT_CLASSES[1]);
    expect(personDotClass('ccc', roster)).toBe(PERSON_DOT_CLASSES[2]);
    expect(personDotClass('bbb', ['ccc', 'bbb', 'aaa'])).toBe(PERSON_DOT_CLASSES[1]);
  });

  it('is collision-free within a palette-sized roster', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const classes = ids.map(id => personDotClass(id, ids));
    expect(new Set(classes).size).toBe(ids.length);
  });

  it('degrades to a stable hash for an id outside the roster', () => {
    const out = personDotClass('stranger', roster);
    expect(PERSON_DOT_CLASSES).toContain(out);
    expect(personDotClass('stranger', roster)).toBe(out);
  });
});
