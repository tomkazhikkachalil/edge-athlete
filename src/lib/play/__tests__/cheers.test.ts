import { describe, expect, it } from 'vitest';
import { CHEERS, emptyTotals, freshEvents, isCheerKey, parseCheerContext, tally } from '../cheers';

describe('live cheers (pure)', () => {
  it('six keys, matching 244\'s CHECK, each with an emoji', () => {
    expect(CHEERS.map(c => c.key)).toEqual(['fire', 'clap', 'flex', 'target', 'hands', 'wow']);
    expect(isCheerKey('fire')).toBe(true);
    expect(isCheerKey('🔥')).toBe(false);
    expect(isCheerKey('toString')).toBe(false);
  });
  it('the two live contexts parse; nothing else does', () => {
    expect(parseCheerContext('group_post:e0000000-0000-4000-8000-000000000001')).toEqual({ kind: 'group_post', id: 'e0000000-0000-4000-8000-000000000001' });
    expect(parseCheerContext('sport_event_round:e0000000-0000-4000-8000-000000000001')?.kind).toBe('sport_event_round');
    expect(parseCheerContext('contest:e0000000-0000-4000-8000-000000000001')).toBeNull();
    expect(parseCheerContext('group_post:nope')).toBeNull();
  });
  it('tally counts known keys only', () => {
    expect(tally([{ cheer: 'fire' }, { cheer: 'fire' }, { cheer: 'wow' }, { cheer: 'x' }])).toEqual({ totals: { ...emptyTotals(), fire: 2, wow: 1 }, total: 3 });
  });
  it('fresh events: oldest first, never one already seen', () => {
    const recent = [
      { id: 'b', cheer: 'clap' as const, target: null, at: '2026-09-28T10:00:02Z' },
      { id: 'a', cheer: 'fire' as const, target: null, at: '2026-09-28T10:00:01Z' },
      { id: 'c', cheer: 'wow' as const, target: null, at: '2026-09-28T10:00:03Z' },
    ];
    expect(freshEvents(recent, new Set(['c'])).map(e => e.id)).toEqual(['a', 'b']);
  });
});
