import { describe, expect, it } from 'vitest';
import { GRID, collides, compactLayout, newInstanceId, sortByPosition, validateLayout, type SiteLayout, type WidgetInstance } from '../layout';
import { LayoutSchema, parseStoredLayout } from '../layout-schema';

const w = (id: string, key: WidgetInstance['key'], x: number, y: number, w: number, h: number): WidgetInstance => ({
  id, key, x, y, w, h, cv: 1, config: {}, visibility: 'public',
});
const layout = (widgets: WidgetInstance[]): SiteLayout => ({ version: 1, cols: 12, widgets });

describe('grid geometry', () => {
  it('collides is symmetric and edge-exclusive', () => {
    const a = w('a', 'standings', 0, 0, 6, 2);
    expect(collides(a, w('b', 'teams', 6, 0, 6, 2))).toBe(false); // touching edges do not overlap
    expect(collides(a, w('b', 'teams', 5, 1, 6, 2))).toBe(true);
    expect(collides(w('b', 'teams', 5, 1, 6, 2), a)).toBe(true);
    expect(collides(a, w('b', 'teams', 0, 2, 6, 2))).toBe(false);
  });

  it('sortByPosition is reading order (y, then x)', () => {
    const items = [w('c', 'news', 6, 1, 6, 1), w('a', 'hero', 0, 0, 12, 1), w('b', 'staff', 0, 1, 6, 1)];
    expect(sortByPosition(items).map(i => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('compactLayout floats widgets up, keeps side-by-side pairs, never overlaps, is idempotent', () => {
    const gappy = [w('a', 'hero', 0, 0, 12, 2), w('b', 'standings', 0, 4, 6, 2), w('c', 'teams', 6, 7, 6, 2)];
    const once = compactLayout(gappy);
    expect(once.find(i => i.id === 'b')!.y).toBe(2);
    expect(once.find(i => i.id === 'c')!.y).toBe(2); // sits beside b, not under it
    expect(validateLayout(layout(once))).toEqual([]);
    expect(compactLayout(once)).toEqual(once);
  });

  it('compactLayout resolves an overlapping input by pushing the later widget down', () => {
    const overlapping = [w('a', 'standings', 0, 0, 12, 2), w('b', 'teams', 0, 1, 12, 2)];
    const fixed = compactLayout(overlapping);
    expect(fixed.find(i => i.id === 'b')!.y).toBe(2);
    expect(validateLayout(layout(fixed))).toEqual([]);
  });

  it('validateLayout reports bounds, constraint and overlap issues', () => {
    const issues = validateLayout(
      layout([
        w('a', 'hero', 0, 0, 6, 2), // hero must be 12 wide
        w('b', 'standings', 8, 1, 6, 2), // runs past the grid (8+6 > 12)
        w('c', 'teams', 0, 1, 12, 2), // overlaps a
      ])
    );
    const messages = issues.map(i => i.message);
    expect(messages.some(m => m.includes('hero must be 12'))).toBe(true);
    expect(messages.some(m => m.includes('runs past the grid'))).toBe(true);
    expect(messages.some(m => m.includes('overlaps'))).toBe(true);
    expect(validateLayout(layout([w('a', 'hero', 0, 0, 12, 3), w('b', 'standings', 0, 3, 6, 4)]))).toEqual([]);
  });

  it('newInstanceId is opaque, prefixed, hex, and uses the injected randomness', () => {
    const id = newInstanceId(bytes => bytes.map((_, i) => i * 17));
    expect(id).toMatch(/^w_[0-9a-f]{16}$/);
    expect(newInstanceId()).toMatch(/^w_[0-9a-f]{16}$/);
    expect(newInstanceId()).not.toBe(newInstanceId());
  });
});

describe('LayoutSchema', () => {
  it('accepts a valid envelope with defaults and rejects duplicate ids, foreign keys and overruns', () => {
    const ok = LayoutSchema.safeParse({ version: 1, cols: GRID.cols, widgets: [{ id: 'a', key: 'hero', x: 0, y: 0, w: 12, h: 3, cv: 1 }] });
    expect(ok.success).toBe(true);
    expect(ok.data!.widgets[0].visibility).toBe('public');
    expect(ok.data!.widgets[0].config).toEqual({});
    const dup = { version: 1, cols: 12, widgets: [{ id: 'a', key: 'hero', x: 0, y: 0, w: 12, h: 3, cv: 1 }, { id: 'a', key: 'teams', x: 0, y: 3, w: 12, h: 3, cv: 1 }] };
    expect(LayoutSchema.safeParse(dup).success).toBe(false);
    expect(LayoutSchema.safeParse({ version: 1, cols: 12, widgets: [{ id: 'a', key: 'week', x: 0, y: 0, w: 6, h: 2, cv: 1 }] }).success).toBe(false);
    expect(LayoutSchema.safeParse({ version: 1, cols: 12, widgets: [{ id: 'a', key: 'teams', x: 8, y: 0, w: 6, h: 2, cv: 1 }] }).success).toBe(false);
    expect(LayoutSchema.safeParse({ version: 2, cols: 12, widgets: [] }).success).toBe(false);
  });
  it('parseStoredLayout never throws and returns null for garbage', () => {
    expect(parseStoredLayout(null)).toBeNull();
    expect(parseStoredLayout({ version: 1 })).toBeNull();
    expect(parseStoredLayout({ version: 1, cols: 12, widgets: [] })).toEqual({ version: 1, cols: 12, widgets: [] });
  });
});

describe('adding and removing widgets (P3-D)', () => {
  const site = {
    modules: [
      { module_key: 'hero', enabled: true, sort_order: 0, config: {} },
      { module_key: 'sponsors', enabled: false, sort_order: 7, config: { sponsors: [{ name: 'Acme' }] } },
    ],
    hero_config: { headline: 'Hi' },
    contact_config: { email: 'x@y.z' },
    visibility: 'private' as const,
  };
  it('newInstanceFor: default size, no options, visibility from the members-only policy', async () => {
    const { newInstanceFor } = await import('../layout');
    expect(newInstanceFor(site, 'sponsors', 'w_1')).toMatchObject({ id: 'w_1', key: 'sponsors', w: 6, config: {}, visibility: 'public' });
    expect(newInstanceFor(site, 'hero', 'w_2')).toMatchObject({ w: 12, config: {} });
    expect(newInstanceFor(site, 'standings', 'w_4')).toMatchObject({ visibility: 'members', config: {} });
  });
  it('appendWidget places the newcomer at the bottom, a half slides up beside a half; removeWidget compacts', async () => {
    const { appendWidget, removeWidget, layoutBottom, newInstanceFor } = await import('../layout');
    const base = layout([w('a', 'hero', 0, 0, 12, 3), w('b', 'standings', 0, 3, 6, 4)]);
    expect(layoutBottom(base.widgets)).toBe(7);
    const withTeams = appendWidget(base, newInstanceFor(site, 'teams', 'w_t')); // full width → below b
    const teams = withTeams.widgets.find(i => i.id === 'w_t')!;
    expect(teams.y).toBe(7);
    expect(validateLayout(withTeams)).toEqual([]);
    const withStaff = appendWidget(base, newInstanceFor(site, 'staff', 'w_s')); // half → could sit beside b
    const staff = withStaff.widgets.find(i => i.id === 'w_s')!;
    // Appended at x=0 below b; compaction keeps it under b (same column), never overlapping.
    expect(staff.x).toBe(0);
    expect(staff.y).toBe(7);
    expect(validateLayout(withStaff)).toEqual([]);
    const without = removeWidget(withTeams, 'b');
    expect(without.widgets.map(i => i.id)).toEqual(['a', 'w_t']);
    expect(without.widgets.find(i => i.id === 'w_t')!.y).toBe(3); // compacted up
  });
});
