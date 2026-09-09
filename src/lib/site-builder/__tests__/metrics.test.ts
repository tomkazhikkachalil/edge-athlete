import { describe, expect, it } from 'vitest';
import { parsePublishStats, publishStats } from '../metrics';
import { place } from '../seeds';
import type { SiteLayout } from '../layout';

const L = (...widgets: SiteLayout['widgets']): SiteLayout => ({ version: 1, cols: 12, widgets });

describe('publishStats (phase 8)', () => {
  const now = '2026-09-09T12:00:00.000Z';
  it('the first publish of a materialised site: nothing to diff, the site’s age recorded', () => {
    const s = publishStats({ prev: null, next: null, firstPublish: true, draftCreatedAt: null, siteCreatedAt: '2026-09-09T11:15:00.000Z', now });
    expect(s).toEqual({ v: 1, widgetCount: null, widgetsTouched: 0, added: [], removed: [], firstPublish: true, secondsSinceDraft: null, secondsSinceSiteCreated: 2700 });
  });
  it('a first grid publish counts every tile as touched', () => {
    const next = L(place('hero', 0, 0), place('standings', 0, 3), place('schedule', 6, 3));
    const s = publishStats({ prev: null, next, firstPublish: true, draftCreatedAt: '2026-09-09T11:50:00.000Z', siteCreatedAt: '2026-09-09T11:00:00.000Z', now });
    expect(s).toMatchObject({ widgetCount: 3, widgetsTouched: 3, added: ['hero', 'schedule', 'standings'], removed: [], firstPublish: true, secondsSinceDraft: 600, secondsSinceSiteCreated: 3600 });
  });
  it('a later publish diffs by instance id — moved or resized tiles count, untouched ones do not; keys added/removed', () => {
    const prev = L(place('hero', 0, 0), place('standings', 0, 3), place('schedule', 6, 3), place('staff', 0, 7));
    const next = L(place('hero', 0, 0), place('standings', 0, 3, { h: 6 }), place('schedule', 6, 3), place('text', 0, 9, undefined, { id: 'w_t' }));
    const s = publishStats({ prev, next, firstPublish: false, draftCreatedAt: '2026-09-09T11:59:30.000Z', siteCreatedAt: null, now });
    expect(s).toMatchObject({ widgetCount: 4, widgetsTouched: 2, added: ['text'], removed: ['staff'], firstPublish: false, secondsSinceDraft: 30, secondsSinceSiteCreated: null });
  });
  it('bad timestamps never throw; parsePublishStats round-trips and refuses junk', () => {
    const s = publishStats({ prev: null, next: null, firstPublish: false, draftCreatedAt: 'nope', siteCreatedAt: undefined as unknown as null, now });
    expect(s.secondsSinceDraft).toBeNull();
    expect(parsePublishStats(s)).toEqual(s);
    expect(parsePublishStats({ v: 2 })).toBeNull();
    expect(parsePublishStats(null)).toBeNull();
    expect(parsePublishStats({ v: 1, widgetsTouched: 'x', added: [1, 'a'] })).toMatchObject({ widgetsTouched: 0, added: ['a'] });
  });
});
