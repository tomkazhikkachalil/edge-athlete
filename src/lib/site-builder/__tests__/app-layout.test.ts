import { describe, expect, it } from 'vitest';
import { APP_WINDOW_KEYS, deriveAppLayout, isOrgWindowKey } from '../app-layout';

// The glance grid's push order on Sep 9 2026 (Org Pages R3–R5), recorded
// from OrgGlanceGrid.tsx before it read the registry. Zero visual change
// means this array is the contract: key, bubble identity, span, in order.
const RECORDED = [
  { key: 'members', bubbleKey: 'members', span: 'sm' },
  { key: 'week', bubbleKey: 'week', span: 'md' },
  { key: 'standings', bubbleKey: 'standings', span: 'md' },
  { key: 'schedule', bubbleKey: 'events', span: 'sm' },
  { key: 'news', bubbleKey: 'news', span: 'sm' },
  { key: 'announcements', bubbleKey: 'announcements', span: 'sm' },
  { key: 'venues', bubbleKey: 'courses', span: 'sm' },
  { key: 'activity', bubbleKey: 'activity', span: 'sm' },
  { key: 'gallery', bubbleKey: 'photos', span: 'md' },
  { key: 'affiliations', bubbleKey: 'affiliations', span: 'sm' },
  { key: 'posts', bubbleKey: 'posts', span: 'lg' },
] as const;

// e2e/helpers/org-page.ts OrgWindowKey — the ten windows the grid hosts.
const HELPER_WINDOW_KEYS = [
  'members', 'week', 'standings', 'events', 'news', 'announcements', 'courses', 'activity', 'affiliations', 'photos',
];

describe('deriveAppLayout', () => {
  it('reproduces the recorded glance order exactly — with no composition, null or undefined (phase 10 fallback)', () => {
    for (const arg of [undefined, null]) {
      const slots = deriveAppLayout(arg).map(s => ({ key: s.key, bubbleKey: s.bubbleKey, span: s.span }));
      expect(slots).toEqual(RECORDED.map(r => ({ ...r })));
      for (const s of deriveAppLayout(arg)) expect([s.instanceId, s.title]).toEqual([null, null]);
    }
  });

  it('H3: a composition with two instances of one bubble key yields ONE bubble (the first in reading order); content tiles all render', () => {
    const comp = {
      widgets: [
        { id: 's1', key: 'standings' as const, w: 6, title: 'Div 1', visibility: 'public' as const },
        { id: 't1', key: 'text' as const, w: 12, title: null, visibility: 'public' as const },
        { id: 's2', key: 'standings' as const, w: 6, title: 'Div 2', visibility: 'public' as const },
        { id: 't2', key: 'text' as const, w: 12, title: null, visibility: 'public' as const },
        { id: 'e1', key: 'schedule' as const, w: 12, title: null, visibility: 'public' as const },
        { id: 'e2', key: 'schedule' as const, w: 12, title: null, visibility: 'public' as const },
      ],
    };
    const slots = deriveAppLayout(comp);
    const standings = slots.filter(s => s.bubbleKey === 'standings');
    expect(standings).toHaveLength(1);
    expect(standings[0]).toMatchObject({ instanceId: 's1', title: 'Div 1' });
    expect(slots.filter(s => s.bubbleKey === 'events')).toHaveLength(1);
    expect(slots.filter(s => s.key === 'text').map(s => s.instanceId)).toEqual(['t1', 't2']);
    const bubbleKeys = slots.filter(s => s.bubbleKey !== null).map(s => s.bubbleKey);
    expect(new Set(bubbleKeys).size).toBe(bubbleKeys.length);
    expect(APP_WINDOW_KEYS).toHaveLength(HELPER_WINDOW_KEYS.length);
  });

  it('priorities are unique and strictly ascending; bubble keys unique', () => {
    const slots = deriveAppLayout();
    for (let i = 1; i < slots.length; i++) expect(slots[i].priority).toBeGreaterThan(slots[i - 1].priority);
    expect(new Set(slots.map(s => s.bubbleKey)).size).toBe(slots.length);
  });

  it('the posts wall is last and owns its window; nothing else does', () => {
    const slots = deriveAppLayout();
    expect(slots[slots.length - 1].key).toBe('posts');
    expect(slots.filter(s => s.ownsWindow).map(s => s.key)).toEqual(['posts']);
  });

  it('APP_WINDOW_KEYS is the e2e helper’s ten window keys', () => {
    expect([...APP_WINDOW_KEYS].sort()).toEqual([...HELPER_WINDOW_KEYS].sort());
    expect(isOrgWindowKey('photos')).toBe(true);
    expect(isOrgWindowKey('posts')).toBe(false);
    expect(isOrgWindowKey('gallery')).toBe(false);
  });
});
