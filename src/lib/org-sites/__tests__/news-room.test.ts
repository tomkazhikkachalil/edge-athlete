import { describe, expect, it } from 'vitest';
import { composerValues, groupNews, hasPendingDraft, stateLine } from '../news-room';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const row = (id: string, published_at: string | null, extra: Record<string, unknown> = {}) => ({ id, slug: id, title: id, published_at, ...extra });

describe('groupNews', () => {
  it('drafts · scheduled (soonest first) · live (newest first)', () => {
    const g = groupNews(
      [row('d1', null), row('s-late', '2026-10-10T00:00:00Z'), row('l-old', '2026-09-01T00:00:00Z'), row('s-soon', '2026-09-30T00:00:00Z'), row('l-new', '2026-09-26T00:00:00Z')],
      NOW
    );
    expect(g.drafts.map(r => r.id)).toEqual(['d1']);
    expect(g.scheduled.map(r => r.id)).toEqual(['s-soon', 's-late']);
    expect(g.live.map(r => r.id)).toEqual(['l-new', 'l-old']);
  });
});

describe('composerValues', () => {
  it('a live post shows its pending draft over the columns', () => {
    const v = composerValues(row('p', '2026-09-01T00:00:00Z', { title: 'Old', summary: 'S', audience: 'members', draft: { title: 'Typing', coverPath: null } }) as never);
    expect(v).toMatchObject({ title: 'Typing', summary: 'S', audience: 'members', coverPath: null });
  });
  it('no draft → the columns', () => {
    expect(composerValues(row('p', null, { title: 'T', body: [{ type: 'paragraph', text: 'x' }] }) as never)).toMatchObject({ title: 'T', body: [{ type: 'paragraph', text: 'x' }], audience: 'public' });
  });
});

describe('hasPendingDraft / stateLine', () => {
  it('pending only for a live post with draft edits', () => {
    expect(hasPendingDraft(row('p', '2026-09-01T00:00:00Z', { draft: { title: 'x' } }) as never, NOW)).toBe(true);
    expect(hasPendingDraft(row('p', '2026-09-01T00:00:00Z', { draft: null }) as never, NOW)).toBe(false);
    expect(hasPendingDraft(row('p', null, { draft: { title: 'x' } }) as never, NOW)).toBe(false);
  });
  it('the line names the state', () => {
    expect(stateLine('draft', null, false)).toMatch(/^Draft/);
    expect(stateLine('live', '2026-09-01T00:00:00Z', true)).toMatch(/Press Update/);
    expect(stateLine('scheduled', '2026-10-01T00:00:00Z', false)).toMatch(/^Scheduled/);
  });
});
