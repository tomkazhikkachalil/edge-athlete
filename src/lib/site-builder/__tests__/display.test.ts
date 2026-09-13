import { describe, expect, it } from 'vitest';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { SITE_WIDGET_KEYS, WIDGETS } from '../catalog';
import { DISPLAY_FIELDS, DISPLAY_ORDER_MAX, applyOrder, displayDefault, displayDefaults, instanceDisplay, orderIdOf, orderItems, sortAlpha } from '../display';
import { displayFieldsFor, fieldsFor } from '../fields';
import { displaySchemaFor, instanceSchemaFor } from '../schemas';
import { place } from '../seeds';

// Program 3, D1 — the display vocabulary. ONE declaration, generated
// everywhere: the schema is BUILT from it, the panel renders it, the
// reader fills the defaults. The pins: no drift between the three, the
// identity (no `display` → the defaults, which are today's look), the
// order rule, and the shape every widget's declaration must keep.

const EMPTY: SiteHomeData = { standings: null, events: null, teams: [], staff: [], venues: [], affiliations: [], openWindows: [], courses: [], divisions: [], leaders: [] };

describe('the declaration', () => {
  it('every site widget declares (possibly nothing); a choice has ≥ 2 options with distinct values, a count sane bounds and a default inside them, and the order only beside a manual sort', () => {
    for (const key of SITE_WIDGET_KEYS) {
      const fields = DISPLAY_FIELDS[key];
      expect(Array.isArray(fields), key).toBe(true);
      const names = fields.map(f => f.name);
      expect(new Set(names).size, `${key} names unique`).toBe(names.length);
      for (const f of fields) {
        if (f.kind === 'choice') {
          expect(f.options.length, `${key}.${f.name}`).toBeGreaterThanOrEqual(2);
          expect(new Set(f.options.map(o => o.value)).size).toBe(f.options.length);
        }
        if (f.kind === 'count') {
          expect(f.min).toBeLessThan(f.max);
          expect(f.default).toBeGreaterThanOrEqual(f.min);
          expect(f.default).toBeLessThanOrEqual(f.max);
        }
        if (f.kind === 'order') {
          const sort = fields.find(x => x.name === 'sort');
          expect(sort?.kind === 'choice' && sort.options.some(o => o.value === 'manual'), `${key} order needs a manual sort`).toBe(true);
          expect(key in orderIdOf, `${key} needs an order id rule`).toBe(true);
        }
      }
    }
    // A widget the vocabulary reaches in D1: the pattern, not a one-off.
    expect(DISPLAY_FIELDS.standings.map(f => f.name)).toEqual(['variant', 'count', 'sort', 'click', 'height']);
    expect(DISPLAY_FIELDS.teams.map(f => f.name)).toEqual(['variant', 'sort', 'order', 'click', 'height']);
    // H1: the height axis on every widget but the hero, last.
    for (const key of SITE_WIDGET_KEYS) {
      const names = DISPLAY_FIELDS[key].map(f => f.name);
      if (key === 'hero') expect(names).not.toContain('height');
      else expect(names[names.length - 1], key).toBe('height');
    }
    // Widgets with a query limit declare no `count` — the limit IS the count.
    for (const key of ['schedule', 'news', 'teams', 'members'] as const) expect(DISPLAY_FIELDS[key].some(f => f.name === 'count'), key).toBe(false);
  });

  it('the schema is built from the declaration: every declared key, each option accepted, a stranger refused, out-of-range counts refused, unknown keys kept', () => {
    for (const key of SITE_WIDGET_KEYS) {
      const schema = displaySchemaFor(key);
      const shape = Object.keys(schema.shape);
      expect(shape.sort()).toEqual(DISPLAY_FIELDS[key].map(f => f.name).sort());
      for (const f of DISPLAY_FIELDS[key]) {
        if (f.kind === 'choice') {
          for (const o of f.options) expect(schema.safeParse({ [f.name]: o.value }).success, `${key}.${f.name}=${o.value}`).toBe(true);
          expect(schema.safeParse({ [f.name]: 'not-an-option' }).success).toBe(false);
        }
        if (f.kind === 'count') {
          expect(schema.safeParse({ [f.name]: f.min }).success).toBe(true);
          expect(schema.safeParse({ [f.name]: f.max + 1 }).success).toBe(false);
          expect(schema.safeParse({ [f.name]: 1.5 }).success).toBe(false);
        }
        if (f.kind === 'toggle') expect(schema.safeParse({ [f.name]: 'yes' }).success).toBe(false);
        if (f.kind === 'order') {
          expect(schema.safeParse({ order: ['a', 'b'] }).success).toBe(true);
          expect(schema.safeParse({ order: Array.from({ length: DISPLAY_ORDER_MAX + 1 }, (_, i) => String(i)) }).success).toBe(false);
        }
      }
      expect(schema.safeParse({ futureKey: 1 }).success).toBe(true);
      // The instance schema carries `display` for every widget.
      expect(Object.keys(instanceSchemaFor(key).shape)).toContain('display');
      expect(instanceSchemaFor(key).safeParse({ display: { futureKey: true } }).success).toBe(true);
    }
    expect(instanceSchemaFor('standings').safeParse({ display: { variant: 'full', count: 8 } }).success).toBe(true);
    expect(instanceSchemaFor('standings').safeParse({ display: { variant: 'sideways' } }).success).toBe(false);
  });

  it('the panel fields mirror the declaration, after the query fields', () => {
    for (const key of SITE_WIDGET_KEYS) {
      const panel = fieldsFor(key);
      const display = panel.filter(f => f.kind === 'display');
      expect(display.map(f => f.name)).toEqual(DISPLAY_FIELDS[key].map(f => f.name));
      expect(displayFieldsFor(key).every(f => f.scope === 'display')).toBe(true);
      const lastNonDisplay = panel.findLastIndex(f => f.kind !== 'display');
      const firstDisplay = panel.findIndex(f => f.kind === 'display');
      if (firstDisplay >= 0) expect(firstDisplay).toBeGreaterThan(lastNonDisplay);
    }
  });
});

describe('instanceDisplay — the reader', () => {
  it('identity: no display → the defaults, and every default is the first option / the declared count / false / []', () => {
    for (const key of SITE_WIDGET_KEYS) {
      const w = place(key, 0, 0);
      expect(instanceDisplay(w)).toEqual(displayDefaults(key));
      for (const f of DISPLAY_FIELDS[key]) {
        const v = displayDefault(f);
        if (f.kind === 'choice') expect(v).toBe(f.options[0].value);
        if (f.kind === 'count') expect(v).toBe(f.default);
        if (f.kind === 'toggle') expect(v).toBe(f.default ?? false);
        if (f.kind === 'order') expect(v).toEqual([]);
      }
    }
  });

  it('validates each key and falls back: an unknown choice, a clamped count, a non-boolean toggle, a malformed order; junk display; never through content', () => {
    const w = place('standings', 0, 0, undefined, { config: { display: { variant: 'sideways', count: 99, click: 'none', extra: 1 } } });
    expect(instanceDisplay(w)).toEqual({ variant: 'compact', count: 20, sort: 'rank', click: 'none', height: 'auto' });
    expect(instanceDisplay(place('standings', 0, 0, undefined, { config: { display: { count: 1 } } })).count).toBe(3);
    expect(instanceDisplay(place('standings', 0, 0, undefined, { config: { display: 'junk' } }))).toEqual(displayDefaults('standings'));
    const t = place('teams', 0, 0, undefined, { config: { display: { sort: 'manual', order: ['a', 3, '', 'b'] } } });
    expect(instanceDisplay(t).order).toEqual(['a', 'b']);
    const c = place('courses', 0, 0, undefined, { config: { display: { showRounds: 'no' } } });
    expect(instanceDisplay(c).showRounds).toBe(true);
    expect(instanceDisplay(place('courses', 0, 0, undefined, { config: { display: { showRounds: false } } })).showRounds).toBe(false);
    // D4: every site widget declares at least one axis now.
    for (const key of SITE_WIDGET_KEYS) expect(DISPLAY_FIELDS[key].length, key).toBeGreaterThan(0);
    expect(instanceDisplay(place('news', 0, 0, undefined, { config: { display: { variant: 'x', click: 'inline' } } }))).toEqual({ variant: 'list', sort: 'newest', order: [], click: 'inline', height: 'auto' });
    // A text field trims and caps; a non-string falls back to ''.
    expect(instanceDisplay(place('contact_form', 0, 0, undefined, { config: { display: { button: '  Join us  ' } } })).button).toBe('Join us');
    expect(instanceDisplay(place('contact_form', 0, 0, undefined, { config: { display: { button: 'x'.repeat(40) } } })).button).toHaveLength(24);
    expect(instanceDisplay(place('contact_form', 0, 0, undefined, { config: { display: { button: 7 } } })).button).toBe('');
  });
});

describe('applyOrder / sortAlpha / orderItems', () => {
  const items = [{ id: 'a', n: 'Zed' }, { id: 'b', n: 'alpha' }, { id: 'c', n: 'Mid' }];
  it('listed ids first in that order, unknown dropped, the rest appended in default order; an empty order is the default; never mutates', () => {
    const frozen = Object.freeze(items.map(i => Object.freeze(i)));
    expect(applyOrder(frozen, ['c', 'zzz', 'a'], i => i.id).map(i => i.id)).toEqual(['c', 'a', 'b']);
    expect(applyOrder(frozen, [], i => i.id).map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(applyOrder(frozen, ['b', 'b'], i => i.id).map(i => i.id)).toEqual(['b', 'a', 'c']);
    expect(frozen.map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(sortAlpha(frozen, i => i.n).map(i => i.n)).toEqual(['alpha', 'Mid', 'Zed']);
  });
  it('orderItems lists a widget’s items with the SAME ids the renderers order by', () => {
    const data: SiteHomeData = {
      ...EMPTY,
      teams: [{ id: 't1', name: 'Wolves', divisionLabels: [] }],
      staff: [{ name: 'Jamie R.', role: 'owner' }],
      venues: [{ id: 'v1', name: 'Arena', city: null, region: null, country: null, facilities: [] }],
      divisions: [{ seasonLabel: '2026', divisionName: 'U13', ageBand: null, tier: null, teams: [] }],
    };
    expect(orderItems('teams', data, {})).toEqual([{ id: orderIdOf.teams(data.teams[0]), label: 'Wolves' }]);
    expect(orderItems('staff', data, {})[0].id).toBe('Jamie R.');
    expect(orderItems('venues', data, {})[0].id).toBe('v1');
    expect(orderItems('divisions', data, {})[0].id).toBe('2026:U13');
    expect(orderItems('documents', data, { documents: [{ title: 'Rules' }, { nope: 1 }, { title: '' }] })).toEqual([{ id: 'Rules', label: 'Rules' }]);
    expect(orderItems('standings', data, {})).toEqual([]);
  });
  it('every widget that orders items reads a data key it declares (or its own config)', () => {
    for (const key of Object.keys(orderIdOf) as (keyof typeof orderIdOf)[]) {
      if (key === 'documents') continue;
      expect(WIDGETS[key].data.length, key).toBeGreaterThan(0);
    }
  });
});
