// ── The org switches (teams & divisions program, Sep 26 2026; mig 242) ───────
// `organizations.operates_teams` / `operates_competitions` — "We run teams" /
// "We run competitions" — turn their part of the product on and off: the
// console's sections, the in-app org page's tiles and the public site's
// widgets and pages. Off HIDES; it never deletes (Tom). ZERO imports on
// purpose: the org-page client chunk reads it (guardrail 4c), like
// site-builder/catalog.ts.
//
// Every console section and every widget key is classified exactly once
// (switches.test.ts pins it against authz.ts ORG_SECTIONS and catalog.ts
// WIDGET_KEYS) — a new section or widget must say which switch owns it.

export interface OrgSwitches {
  teams: boolean;
  competitions: boolean;
}

export const ALL_ON: OrgSwitches = { teams: true, competitions: true };

/** 'either': divisions and seasons serve competitions AND teams. */
export type SwitchRule = 'teams' | 'competitions' | 'either' | 'always';

export function switchAllows(s: OrgSwitches, rule: SwitchRule): boolean {
  switch (rule) {
    case 'teams':
      return s.teams;
    case 'competitions':
      return s.competitions;
    case 'either':
      return s.teams || s.competitions;
    case 'always':
      return true;
  }
}

/** The switches off an org row. A missing / non-boolean value reads ON: a
 *  failed read SHOWS the org's things, never hides them. */
export function switchesOf(row: { operates_teams?: unknown; operates_competitions?: unknown } | null | undefined): OrgSwitches {
  return {
    teams: row?.operates_teams === false ? false : true,
    competitions: row?.operates_competitions === false ? false : true,
  };
}

/** The console's sections and views (authz.ts ORG_SECTIONS + the views). */
export const CONSOLE_SECTION_SWITCH: Readonly<Record<string, SwitchRule>> = {
  website: 'always',
  roster: 'always',
  membership: 'always',
  seasons: 'either',
  teams: 'teams',
  competitions: 'competitions',
  registrations: 'always',
  external: 'always',
  venues: 'always',
  hierarchy: 'always',
};

/** Every widget key — the public site's modules (≡ web widgets), the content
 *  widgets and the app-only widgets. One composition renders the site AND the
 *  in-app org page (convention 12), so one map serves both. `schedule` stays
 *  on: calendar events are not competitions. */
export const WIDGET_SWITCH: Readonly<Record<string, SwitchRule>> = {
  hero: 'always',
  standings: 'competitions',
  schedule: 'always',
  teams: 'teams',
  staff: 'always',
  venues: 'always',
  affiliations: 'always',
  sponsors: 'always',
  contact: 'always',
  news: 'always',
  gallery: 'always',
  register: 'always',
  courses: 'always',
  divisions: 'either',
  leaders: 'competitions',
  documents: 'always',
  members: 'always',
  text: 'always',
  image: 'always',
  embed: 'always',
  contact_form: 'always',
  interest_form: 'always',
  week: 'competitions',
  announcements: 'always',
  activity: 'always',
  posts: 'always',
};

/** A key nobody classified reads 'always' at runtime (shown, never hidden);
 *  the test is what refuses it at the gate. */
export function widgetAllowed(s: OrgSwitches, key: string): boolean {
  return switchAllows(s, WIDGET_SWITCH[key] ?? 'always');
}

export function sectionAllowed(s: OrgSwitches, key: string): boolean {
  return switchAllows(s, CONSOLE_SECTION_SWITCH[key] ?? 'always');
}

/** The module rows as a reader sees them: a switched-off module reads
 *  disabled. The rows themselves are never touched — off hides. */
export function gateModules<T extends { module_key: string; enabled: boolean }>(modules: readonly T[], s: OrgSwitches): T[] {
  return modules.map(m => (m.enabled && !widgetAllowed(s, m.module_key) ? { ...m, enabled: false } : m));
}
