import { describe, expect, it } from 'vitest';
import { MODULE_KEYS, MODULE_SUBPAGE_KEYS, TOGGLEABLE_MODULE_KEYS } from '@/lib/org-sites/validate';
import { FULL_WIDTH_MODULES } from '@/lib/org-sites/templates';
import {
  APP_ONLY_WIDGET_KEYS,
  CONTENT_WIDGET_KEYS,
  WEB_WIDGET_KEYS,
  WIDGETS,
  WIDGET_KEYS,
  isWebWidgetKey,
  isWidgetKey,
  type WidgetKey,
} from '../catalog';

// The catalog is a literal copy of the module vocabulary (so the org-page
// chunk never imports validate.ts + zod). These pins are what make the copy
// safe: any drift between the two lists fails here, not in production.
describe('site-builder catalog', () => {
  it('WEB_WIDGET_KEYS is exactly MODULE_KEYS, in order', () => {
    expect([...WEB_WIDGET_KEYS]).toEqual([...MODULE_KEYS]);
  });

  it('every widget key has a definition and vice versa', () => {
    expect(Object.keys(WIDGETS).sort()).toEqual([...WIDGET_KEYS].sort());
    for (const key of WIDGET_KEYS) expect(WIDGETS[key].key).toBe(key);
    expect(new Set(WIDGET_KEYS).size).toBe(WIDGET_KEYS.length);
  });

  it('the toggleable modules are exactly the non-structural web widgets', () => {
    const nonStructural = WEB_WIDGET_KEYS.filter(k => WIDGETS[k].family !== 'structural');
    expect([...nonStructural].sort()).toEqual([...TOGGLEABLE_MODULE_KEYS].sort());
  });

  it('subpage widgets are exactly MODULE_SUBPAGE_KEYS', () => {
    const subpages = WEB_WIDGET_KEYS.filter(k => WIDGETS[k].subpage);
    expect([...subpages].sort()).toEqual([...MODULE_SUBPAGE_KEYS].sort());
    for (const key of APP_ONLY_WIDGET_KEYS) expect(WIDGETS[key].subpage).toBe(false);
  });

  it('full-width default widths are exactly the bold template’s full-width modules (plus hero)', () => {
    const full = WEB_WIDGET_KEYS.filter(k => k !== 'hero' && WIDGETS[k].constraints.defaultSize.w === 12);
    expect(new Set(full)).toEqual(FULL_WIDTH_MODULES);
    expect(WIDGETS.hero.constraints.defaultSize.w).toBe(12);
  });

  it('constraints are sane for every widget', () => {
    for (const key of WIDGET_KEYS) {
      const c = WIDGETS[key].constraints;
      expect(c.minW, key).toBeGreaterThanOrEqual(1);
      expect(c.minW, key).toBeLessThanOrEqual(c.defaultSize.w);
      expect(c.defaultSize.w, key).toBeLessThanOrEqual(c.maxW);
      expect(c.maxW, key).toBeLessThanOrEqual(12);
      expect(c.minH, key).toBeGreaterThanOrEqual(1);
      expect(c.minH, key).toBeLessThanOrEqual(c.defaultSize.h);
      expect(c.defaultSize.h, key).toBeLessThanOrEqual(c.maxH);
    }
    // The hero is the site's identity: always the full width.
    expect(WIDGETS.hero.constraints.minW).toBe(12);
    expect(WIDGETS.hero.constraints.maxW).toBe(12);
  });

  it('the keys are three disjoint sets: module-backed web, content (phase 6), app-only', () => {
    expect([...WIDGET_KEYS]).toEqual([...WEB_WIDGET_KEYS, ...CONTENT_WIDGET_KEYS, ...APP_ONLY_WIDGET_KEYS]);
    const all = [...WEB_WIDGET_KEYS, ...CONTENT_WIDGET_KEYS, ...APP_ONLY_WIDGET_KEYS];
    expect(new Set(all).size).toBe(all.length);
  });

  it('surfaces: web widgets render on the web, app-only widgets only in the app, and moduleKey links the module', () => {
    for (const key of WEB_WIDGET_KEYS) {
      expect(WIDGETS[key].surfaces.default, key).toContain('web');
      expect(WIDGETS[key].moduleKey, key).toBe(key);
    }
    for (const key of APP_ONLY_WIDGET_KEYS) {
      expect(WIDGETS[key].surfaces.default, key).toEqual(['app']);
      expect(WIDGETS[key].surfaces.app, key).toBeDefined();
      expect(WIDGETS[key].moduleKey, key).toBeNull();
      expect(WIDGETS[key].data, key).toEqual([]);
    }
    for (const key of WIDGET_KEYS) {
      const s = WIDGETS[key].surfaces;
      expect(s.default.length, key).toBeGreaterThan(0);
      if (s.default.includes('app')) expect(s.app, `${key} says app but has no app surface`).toBeDefined();
      if (s.app) expect(s.default, `${key} has an app surface but is not flagged app`).toContain('app');
      // Phase 10: a null bubble key (a tile, not a bubble) is the content widgets' alone.
      if (s.app) expect(s.app.bubbleKey === null, `${key} bubbleKey`).toBe((CONTENT_WIDGET_KEYS as readonly string[]).includes(key));
    }
  });

  it('phase 10: pinned app surfaces are exactly members and gallery (the roster window; Photos regardless of the toggle)', () => {
    const pinned = WIDGET_KEYS.filter(k => WIDGETS[k].surfaces.app?.pinned);
    expect([...pinned].sort()).toEqual(['gallery', 'members']);
    for (const key of pinned) expect(WIDGETS[key].surfaces.app, key).toBeDefined();
  });

  it('empty states hide publicly and name a staff line', () => {
    for (const key of WIDGET_KEYS) {
      const e = WIDGETS[key].emptyState;
      if (!e) continue;
      expect(e.public).toBe('hide');
      expect(e.staff.label.length).toBeGreaterThan(0);
    }
  });

  it('type guards', () => {
    expect(isWidgetKey('standings')).toBe(true);
    expect(isWidgetKey('week')).toBe(true);
    expect(isWidgetKey('nope')).toBe(false);
    expect(isWebWidgetKey('week')).toBe(false);
    expect(isWebWidgetKey('hero')).toBe(true);
    const k: WidgetKey = 'posts';
    expect(WIDGETS[k].surfaces.app?.ownsWindow).toBe(true);
  });
});
