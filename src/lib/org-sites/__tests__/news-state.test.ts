import { describe, expect, it } from 'vitest';
import { editColumns, newsState, parseDraft, promoteDraft, publishedAtFor, routeEdit, sameInstant } from '../news-state';

const NOW = Date.parse('2026-09-27T12:00:00.000Z');
const PAST = '2026-09-20T12:00:00.000Z';
const FUTURE = '2026-10-04T12:00:00.000Z';

describe('newsState', () => {
  it('draft · scheduled · live from published_at', () => {
    expect(newsState(null, NOW)).toBe('draft');
    expect(newsState('garbage', NOW)).toBe('draft');
    expect(newsState(FUTURE, NOW)).toBe('scheduled');
    expect(newsState(PAST, NOW)).toBe('live');
    expect(newsState('2026-09-27T12:00:00+00:00', NOW)).toBe('live'); // exactly now is live
  });
});

describe('editColumns / routeEdit', () => {
  it('names only the edited keys, snake_cased', () => {
    expect(editColumns({ title: 'T', coverPath: null, notifyMembers: true })).toEqual({ title: 'T', cover_path: null, notify_members: true });
  });
  it('a team tag clears the division and vice versa (one tag)', () => {
    expect(editColumns({ teamId: 't1' })).toEqual({ team_id: 't1', division_id: null });
    expect(editColumns({ divisionId: 'd1' })).toEqual({ division_id: 'd1', team_id: null });
    expect(editColumns({ teamId: null })).toEqual({ team_id: null });
  });
  it('an unpublished post writes its columns; a live one merges into draft', () => {
    expect(routeEdit('draft', { title: 'New' }, null)).toEqual({ title: 'New' });
    expect(routeEdit('scheduled', { summary: 'S' }, { title: 'ignored' })).toEqual({ summary: 'S' });
    expect(routeEdit('live', { title: 'Typing…' }, { summary: 'Earlier edit', junk: 1 })).toEqual({ draft: { summary: 'Earlier edit', title: 'Typing…' } });
  });
});

describe('promoteDraft', () => {
  it('the draft becomes the post and clears; junk keys never reach a column', () => {
    expect(promoteDraft({ title: 'Final', body: [{ type: 'paragraph', text: 'x' }], evil: 'drop table' })).toEqual({
      title: 'Final',
      body: [{ type: 'paragraph', text: 'x' }],
      draft: null,
    });
    expect(promoteDraft(null)).toEqual({ draft: null });
    expect(parseDraft([1, 2])).toEqual({});
  });
});

describe('publishedAtFor', () => {
  it('now: a draft or a scheduled post goes out now; a live one keeps its date', () => {
    expect(publishedAtFor({ kind: 'now' }, null, NOW)).toBe(new Date(NOW).toISOString());
    expect(publishedAtFor({ kind: 'now' }, FUTURE, NOW)).toBe(new Date(NOW).toISOString());
    expect(publishedAtFor({ kind: 'now' }, PAST, NOW)).toBeNull();
  });
  it('at a time: the future schedules; the past means now', () => {
    expect(publishedAtFor({ kind: 'at', at: FUTURE }, null, NOW)).toBe(FUTURE);
    expect(publishedAtFor({ kind: 'at', at: FUTURE }, PAST, NOW)).toBeNull(); // a live post keeps its date
    expect(publishedAtFor({ kind: 'at', at: FUTURE }, '2026-10-01T00:00:00Z', NOW)).toBe(FUTURE); // a scheduled one moves
    expect(publishedAtFor({ kind: 'at', at: PAST }, null, NOW)).toBe(new Date(NOW).toISOString());
    expect(publishedAtFor({ kind: 'at', at: 'nope' }, null, NOW)).toBe(new Date(NOW).toISOString());
  });
});

describe('sameInstant', () => {
  it('Postgres and JS spellings of one instant are the same', () => {
    expect(sameInstant('2026-09-27T12:00:00.123456+00:00', '2026-09-27T12:00:00.123Z')).toBe(true);
    expect(sameInstant('2026-09-27T12:00:00Z', '2026-09-27T12:00:01Z')).toBe(false);
    expect(sameInstant(null, null)).toBe(true);
  });
});
