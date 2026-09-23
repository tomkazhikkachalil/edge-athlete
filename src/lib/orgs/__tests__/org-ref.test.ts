import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ORG_ID,
  ORG_KIND_EMBED,
  ORG_KIND_EMBED_INNER,
  ORG_KINDS,
  ORG_ROUTE_FAMILY,
  ORG_TABLE,
  PAIR_COLUMN,
  isOrgKind,
  orgIdOf,
  orgKindOf,
  orgRefFromBody,
  orgRefOf,
  otherKind,
  pairFieldsFor,
  pairFieldsOf,
  pairFor,
} from '../org-ref';

describe('org-ref — the one spelling of how an org is named (Round 5 B)', () => {
  it('knows the two kinds and nothing else', () => {
    expect(ORG_KINDS).toEqual(['league', 'club']);
    expect(isOrgKind('league')).toBe(true);
    expect(isOrgKind('club')).toBe(true);
    expect(isOrgKind('school')).toBe(false);
    expect(isOrgKind(null)).toBe(false);
    expect(otherKind('league')).toBe('club');
    expect(otherKind('club')).toBe('league');
  });

  it.each(ORG_KINDS)('%s: the column, the table and the route family agree', kind => {
    expect(PAIR_COLUMN[kind]).toBe(`${kind}_id`);
    expect(ORG_TABLE[kind]).toBe('organizations'); // D1: one table for both kinds
    expect(ORG_ROUTE_FAMILY[kind]).toBe(`${kind}s`);
  });

  it('reads AND writes through org_id (233 fills the pair)', () => {
    expect(ORG_ID).toBe('org_id');
    expect(pairFor({ side: 'league', orgId: 'L' })).toEqual({ org_id: 'L' });
    expect(pairFor({ side: 'club', orgId: 'C' })).toEqual({ org_id: 'C' });
  });

  it('recovers the kind and the ref from a row, league first, null when neither', () => {
    expect(orgKindOf({ league_id: 'L', club_id: null })).toBe('league');
    expect(orgKindOf({ league_id: null, club_id: 'C' })).toBe('club');
    expect(orgKindOf({})).toBeNull();
    expect(orgRefOf({ league_id: 'L' })).toEqual({ side: 'league', orgId: 'L' });
    expect(orgRefOf({ club_id: 'C' })).toEqual({ side: 'club', orgId: 'C' });
    expect(orgRefOf({ league_id: null, club_id: null })).toBeNull();
    expect(orgIdOf({ org_id: 'O', league_id: 'L' })).toBe('O');
    expect(orgIdOf({ league_id: null, club_id: 'C' })).toBe('C');
    expect(orgIdOf({})).toBeNull();
  });

  it('reads the kind through the organizations embed FIRST (step D0), object or array shape', () => {
    expect(ORG_KIND_EMBED).toBe('org:organizations(kind)');
    expect(ORG_KIND_EMBED_INNER).toBe('org:organizations!inner(kind)');
    expect(orgKindOf({ org_id: 'O', org: { kind: 'club' } })).toBe('club');
    expect(orgKindOf({ org_id: 'O', org: [{ kind: 'league' }] })).toBe('league');
    // The embed wins over a stale pair; an unknown kind falls back to the pair.
    expect(orgKindOf({ org_id: 'O', org: { kind: 'club' }, league_id: 'L' })).toBe('club');
    expect(orgKindOf({ org_id: 'O', org: { kind: 'school' }, club_id: 'C' })).toBe('club');
    expect(orgRefOf({ org_id: 'O', org: { kind: 'league' } })).toEqual({ side: 'league', orgId: 'O' });
    // A nullable org_id (events, venues …) with a null embed names no org.
    expect(orgRefOf({ org_id: null, org: null })).toBeNull();
    // org_id without a kind (no embed asked) is an id but not a ref.
    expect(orgIdOf({ org_id: 'O' })).toBe('O');
    expect(orgRefOf({ org_id: 'O' })).toBeNull();
  });

  it('keeps the PUBLIC league_id / club_id fields at the boundary (Tom, Sep 22 2026)', () => {
    const L = '11111111-1111-4111-8111-111111111111';
    const C = '22222222-2222-4222-8222-222222222222';
    expect(orgRefFromBody({ league_id: L })).toEqual({ ok: true, ref: { side: 'league', orgId: L } });
    expect(orgRefFromBody({ club_id: C })).toEqual({ ok: true, ref: { side: 'club', orgId: C } });
    expect(orgRefFromBody({ league_id: null, club_id: null })).toEqual({ ok: true, ref: null });
    expect(orgRefFromBody({})).toEqual({ ok: true, ref: null });
    expect(orgRefFromBody({ league_id: L, club_id: C })).toEqual({ ok: false, error: 'both' });
    expect(orgRefFromBody({ league_id: 'nope' })).toEqual({ ok: false, error: 'invalid' });
    expect(orgRefFromBody({ club_id: 42 })).toEqual({ ok: false, error: 'invalid' });
    expect(pairFieldsFor({ side: 'league', orgId: L })).toEqual({ league_id: L, club_id: null });
    expect(pairFieldsFor({ side: 'club', orgId: C })).toEqual({ league_id: null, club_id: C });
    expect(pairFieldsFor(null)).toEqual({ league_id: null, club_id: null });
    expect(pairFieldsOf({ org_id: C, org: { kind: 'club' } })).toEqual({ league_id: null, club_id: C });
    expect(pairFieldsOf({ org_id: null, org: null })).toEqual({ league_id: null, club_id: null });
  });

  it('has zero imports (client components spell URL families from it)', () => {
    const src = readFileSync(join(__dirname, '..', 'org-ref.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\b/m);
  });

  it('the org row lives in organizations (step D1) — no literal leagues / clubs table read in src', () => {
    const root = join(__dirname, '..', '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === 'node_modules' || name === '__tests__') continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          if (/from\('(leagues|clubs)'\)/.test(readFileSync(p, 'utf8'))) offenders.push(p.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('the pair is UNREAD outside an allowlist (step D0 — every other literal goes through org_id + the embed)', () => {
    // After D0 a pair-table row is read as `org_id` + `org:organizations(kind)`
    // and the public league_id / club_id fields live at the route boundary
    // (orgRefFromBody / pairFieldsFor). What may still spell the pair, and why:
    //   · the notifications `metadata` key (history + the announce readers match on it — forever)
    //   · the side-specific tables league_clubs / league_affiliations / *_requests /
    //     *_join_requests / sanction_grants (their OWN columns — step D-ii / 236 unifies them)
    //   · golf_courses.club_id → golf_clubs (the rename trap — never an org)
    //   · the D0-b subsystems (calendar, sport-events, admin venues, public-data) until that PR
    // A file not listed here may not name the pair at all; a listed file may not
    // exceed its count — the number only ever goes DOWN.
    const ALLOW: Record<string, number> = {
      // class (c) — the notify metadata key, forever
      'lib/clubs/notify.ts': 8,
      'lib/leagues/notify.ts': 8,
      // class (d) — the side-specific tables, until D-ii (236 / D3)
      'lib/affiliations/parents-server.ts': 25,
      'lib/affiliations/server.ts': 20,
      'lib/orgs/sanction-reads.ts': 8,
      'lib/orgs/wizard-replay.ts': 2,
      'lib/orgs/competition-server.ts': 5,
      'lib/org-sites/revalidate.ts': 3,
      'lib/sports/server/official-stats.ts': 11,
      'components/affiliations/AffiliationSection.tsx': 12,
      'components/affiliations/ParentLeaguesSection.tsx': 3,
      'components/orgs/console/HierarchySection.tsx': 1,
      // golf scope — never an org
      'lib/golf/course-catalog.ts': 5,
      'lib/golf/hole-geometry.ts': 5,
      'lib/venues/validate.ts': 5,
      'lib/venues/org-venues-server.ts': 2,
      'lib/competitions/golf-league.ts': 3,
      'lib/competitions/golf-league-server.ts': 5,
      'app/api/golf/courses/route.ts': 11,
      // D0-b (the next PR): calendar · sport-events · admin venues · public-data · site-forms
      'lib/org-sites/public-data.ts': 11,
      'lib/calendar/events.ts': 4,
      'lib/calendar/event-scope.ts': 8,
      'lib/sport-events/validate.ts': 22,
      'lib/sport-events/view.ts': 4,
      'lib/sport-events/types.ts': 2,
      'lib/sport-events/wizard.ts': 2,
      'components/calendar/types.ts': 2,
      'components/calendar/EventDetailModal.tsx': 9,
      'components/calendar/EventFormModal.tsx': 4,
      'app/api/calendar/events/route.ts': 2,
      'app/api/calendar/events/[id]/route.ts': 12,
      'app/api/sport-events/[id]/route.ts': 12,
      'app/api/admin/venues/route.ts': 2,
      'app/(app)/dashboard/venues/page.tsx': 2,
      // the helpers' own output shape (pairFieldsFor / pairFieldsOf), read by name
      'lib/orgs/gallery-gate.ts': 2,
      'lib/orgs/scoped-members.ts': 4,
      // a comment on the rebuilt unique
      'lib/orgs/structure-import.ts': 2,
    };
    const root = join(__dirname, '..', '..', '..');
    const over: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === 'node_modules' || name === '__tests__') continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.endsWith('org-ref.ts')) {
          const rel = p.slice(root.length + 1);
          const text = readFileSync(p, 'utf8');
          const count = (text.match(/\b(league_id|club_id)\b/g) ?? []).length;
          if (count === 0) continue;
          const allowed = ALLOW[rel] ?? 0;
          if (count > allowed) over.push(`${rel}: ${count} (allowed ${allowed})`);
        }
      }
    };
    walk(root);
    expect(over).toEqual([]);
  });

  it('is the ONLY place the pair, the table or the family is spelled from a kind', () => {
    // The 23 `orgColumn` copies and the ~110 inline ternaries this module
    // replaced must not grow back. A new site imports from here.
    const root = join(__dirname, '..', '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === 'node_modules' || name === '__tests__') continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(name) && !p.endsWith('org-ref.ts')) {
          const text = readFileSync(p, 'utf8');
          if (
            /['"]league_id['"]\s*:\s*['"]club_id['"]/.test(text) ||
            /['"]club_id['"]\s*:\s*['"]league_id['"]/.test(text) ||
            /['"]leagues['"]\s*:\s*['"]clubs['"]/.test(text) ||
            /['"]clubs['"]\s*:\s*['"]leagues['"]/.test(text) ||
            /function orgColumn\b|const orgColumn\b/.test(text)
          ) {
            offenders.push(p.slice(root.length + 1));
          }
        }
      }
    };
    if (existsSync(root)) walk(root);
    expect(offenders).toEqual([]);
  });
});
