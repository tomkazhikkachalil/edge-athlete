import { describe, expect, it } from 'vitest';
import { MEMBERS_ONLY_MODULE_KEYS } from '@/lib/org-sites/private';
import { effectiveAudience } from '../audience';
import { WIDGETS } from '../catalog';
import { GRID, LEGACY_ID_PREFIX, deriveLegacyLayout, hasWidget, needsData, normalizeLayout, widget, type LegacySiteShape } from '../layout';

const row = (module_key: string, sort_order: number, enabled = true, config: unknown = {}) => ({
  module_key,
  enabled,
  sort_order,
  config,
});

const publicSite = (modules: LegacySiteShape['modules'], extra: Partial<LegacySiteShape> = {}): LegacySiteShape => ({
  modules,
  hero_config: { headline: 'Welcome' },
  contact_config: { email: 'club@example.com' },
  visibility: 'public',
  ...extra,
});

describe('deriveLegacyLayout', () => {
  it('orders enabled modules by sort_order, full width, y = index, h = the widget default', () => {
    const layout = deriveLegacyLayout(
      publicSite([row('news', 3), row('hero', 1), row('standings', 2), row('teams', 4, false)])
    );
    expect(layout.version).toBe(1);
    expect(layout.cols).toBe(GRID.cols);
    expect(layout.widgets.map(w => w.key)).toEqual(['hero', 'standings', 'news']);
    layout.widgets.forEach((w, i) => {
      expect(w.x).toBe(0);
      expect(w.w).toBe(12);
      expect(w.y).toBe(i);
      expect(w.h).toBe(WIDGETS[w.key].constraints.defaultSize.h);
      expect(w.cv).toBe(1);
      expect(w.id).toBe(`${LEGACY_ID_PREFIX}${w.key}`);
    });
  });

  it('ties keep the incoming (DB) order — a stable sort', () => {
    const layout = deriveLegacyLayout(publicSite([row('schedule', 5), row('teams', 5), row('staff', 5)]));
    expect(layout.widgets.map(w => w.key)).toEqual(['schedule', 'teams', 'staff']);
  });

  it('drops keys the catalog does not know', () => {
    const layout = deriveLegacyLayout(publicSite([row('hero', 1), row('future_module', 2)]));
    expect(layout.widgets.map(w => w.key)).toEqual(['hero']);
  });

  it('sources hero and contact config from the site columns, everything else from the row', () => {
    const sponsors = { sponsors: [{ name: 'Acme' }] };
    const layout = deriveLegacyLayout(
      publicSite([row('hero', 1, true, { stale: true }), row('contact', 2, true, { stale: true }), row('sponsors', 3, true, sponsors)])
    );
    expect(widget(layout, 'hero')?.config).toEqual({ headline: 'Welcome' });
    expect(widget(layout, 'contact')?.config).toEqual({ email: 'club@example.com' });
    expect(widget(layout, 'sponsors')?.config).toBe(sponsors);
  });

  it('a null row config becomes {}', () => {
    const layout = deriveLegacyLayout(publicSite([row('teams', 1, true, null)]));
    expect(widget(layout, 'teams')?.config).toEqual({});
  });

  it('a private club marks the members-only modules; a public one marks nothing', () => {
    const all = ['hero', 'standings', 'teams', 'divisions', 'leaders', 'gallery', 'staff', 'members', 'contact', 'news'];
    const priv = deriveLegacyLayout(publicSite(all.map((k, i) => row(k, i + 1)), { visibility: 'private' }));
    for (const w of priv.widgets) {
      const expected = (MEMBERS_ONLY_MODULE_KEYS as readonly string[]).includes(w.key) ? 'members' : 'public';
      expect(w.visibility, w.key).toBe(expected);
      // The audience helper agrees with the derived visibility.
      expect(effectiveAudience({ visibility: 'private' }, w), w.key).toBe(expected);
    }
    const pub = deriveLegacyLayout(publicSite(all.map((k, i) => row(k, i + 1))));
    for (const w of pub.widgets) expect(w.visibility, w.key).toBe('public');
  });

  it('effectiveAudience: an explicit members/staff visibility wins; the org policy applies to public instances', () => {
    const layout = deriveLegacyLayout(publicSite([row('standings', 1), row('contact', 2)]));
    const standings = widget(layout, 'standings')!;
    const contact = widget(layout, 'contact')!;
    expect(effectiveAudience({ visibility: 'private' }, standings)).toBe('members');
    expect(effectiveAudience({ visibility: 'private' }, contact)).toBe('public');
    expect(effectiveAudience({ visibility: 'public' }, { ...contact, visibility: 'staff' })).toBe('staff');
    expect(effectiveAudience({ visibility: 'private' }, { ...standings, visibility: 'staff' })).toBe('staff');
  });

  it('hasWidget / needsData gate the readers a layout needs', () => {
    const layout = deriveLegacyLayout(publicSite([row('hero', 1), row('courses', 2), row('contact', 3)]));
    expect(hasWidget(layout, 'courses')).toBe(true);
    expect(hasWidget(layout, 'schedule')).toBe(false);
    expect(needsData(layout, 'courses')).toBe(true);
    expect(needsData(layout, 'clubGolfBoards')).toBe(true);
    expect(needsData(layout, 'courseStrip')).toBe(true);
    expect(needsData(layout, 'events')).toBe(false);
    expect(needsData(layout, 'golfRounds')).toBe(false);
    expect(needsData(layout, 'memberStats')).toBe(false);
  });

  it('normalizeLayout is the identity in phase 1', () => {
    const layout = deriveLegacyLayout(publicSite([row('hero', 1)]));
    expect(normalizeLayout(layout)).toBe(layout);
  });

  it('an empty module list yields an empty layout', () => {
    const layout = deriveLegacyLayout(publicSite([]));
    expect(layout.widgets).toEqual([]);
    expect(needsData(layout, 'standings')).toBe(false);
  });
});
