import { describe, expect, it } from 'vitest';
import { ALL_ON, CONSOLE_SECTION_SWITCH, WIDGET_SWITCH, gateModules, sectionAllowed, switchAllows, switchesOf, widgetAllowed } from '../switches';
import { ORG_SECTIONS } from '../authz';
import { WIDGET_KEYS } from '@/lib/site-builder/catalog';
import { MODULE_KEYS } from '@/lib/org-sites/validate';

// Teams & divisions program (Sep 26 2026): the two switches gate the console,
// the org page and the site. Everything is classified exactly once.

describe('every section and widget is classified', () => {
  it('each console section and view has exactly one rule', () => {
    expect(Object.keys(CONSOLE_SECTION_SWITCH).sort()).toEqual([...ORG_SECTIONS, 'hierarchy'].sort());
  });
  it('each widget key (web ≡ modules, content, app-only) has exactly one rule', () => {
    expect(Object.keys(WIDGET_SWITCH).sort()).toEqual([...new Set(WIDGET_KEYS)].sort());
    for (const m of MODULE_KEYS) expect(WIDGET_SWITCH[m], m).toBeDefined();
  });
});

describe('the rules', () => {
  const none = { teams: false, competitions: false };
  const teamsOnly = { teams: true, competitions: false };
  const compsOnly = { teams: false, competitions: true };

  it('the truth table', () => {
    expect(switchAllows(teamsOnly, 'teams')).toBe(true);
    expect(switchAllows(teamsOnly, 'competitions')).toBe(false);
    expect(switchAllows(compsOnly, 'either')).toBe(true);
    expect(switchAllows(none, 'either')).toBe(false);
    expect(switchAllows(none, 'always')).toBe(true);
  });

  it('seasons & divisions show under either switch; teams and competitions under their own', () => {
    expect(sectionAllowed(compsOnly, 'seasons')).toBe(true);
    expect(sectionAllowed(compsOnly, 'teams')).toBe(false);
    expect(sectionAllowed(teamsOnly, 'competitions')).toBe(false);
    expect(widgetAllowed(teamsOnly, 'divisions')).toBe(true);
    expect(widgetAllowed(teamsOnly, 'standings')).toBe(false);
    expect(widgetAllowed(compsOnly, 'teams')).toBe(false);
    expect(widgetAllowed(none, 'schedule')).toBe(true); // calendar events are not competitions
  });

  it('a missing or odd value reads ON — a failed read shows, never hides', () => {
    expect(switchesOf(null)).toEqual(ALL_ON);
    expect(switchesOf({})).toEqual(ALL_ON);
    expect(switchesOf({ operates_teams: null, operates_competitions: 'x' })).toEqual(ALL_ON);
    expect(switchesOf({ operates_teams: false, operates_competitions: true })).toEqual(compsOnly);
    expect(widgetAllowed(none, 'not-a-widget')).toBe(true);
  });

  it('gateModules hides a switched-off module and never touches the others or the input', () => {
    const rows = [
      { module_key: 'teams', enabled: true },
      { module_key: 'standings', enabled: true },
      { module_key: 'news', enabled: false },
    ];
    const out = gateModules(rows, compsOnly);
    expect(out.map(m => [m.module_key, m.enabled])).toEqual([['teams', false], ['standings', true], ['news', false]]);
    expect(rows[0].enabled).toBe(true);
  });
});
