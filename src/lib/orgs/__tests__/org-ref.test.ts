import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ORG_ID,
  ORG_KINDS,
  ORG_ROUTE_FAMILY,
  ORG_TABLE,
  PAIR_COLUMN,
  isOrgKind,
  orgIdOf,
  orgKindOf,
  orgRefOf,
  otherKind,
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
    expect(ORG_TABLE[kind]).toBe(`${kind}s`);
    expect(ORG_ROUTE_FAMILY[kind]).toBe(`${kind}s`);
  });

  it('reads through org_id, writes exactly one of the pair', () => {
    expect(ORG_ID).toBe('org_id');
    expect(pairFor({ side: 'league', orgId: 'L' })).toEqual({ league_id: 'L', club_id: null });
    expect(pairFor({ side: 'club', orgId: 'C' })).toEqual({ league_id: null, club_id: 'C' });
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

  it('has zero imports (client components spell URL families from it)', () => {
    const src = readFileSync(join(__dirname, '..', 'org-ref.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\b/m);
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
