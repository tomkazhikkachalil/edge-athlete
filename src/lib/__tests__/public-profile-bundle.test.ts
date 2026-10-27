import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { reduceMembershipRows } from '../orgs/members';

// Trip-count program PR 1 (Oct 26 2026): GET /api/public/profile reads ONE
// bundle (migration 280) and keeps every rule in TypeScript. The route makes
// no table read of its own; the predicates that used to live in the route's
// PostgREST calls (published only, the statements anti-join, 269's training
// exclusion, the lower-cased handle) live in the function text.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('the public profile is one bundle', () => {
  const route = read('src/app/api/public/profile/route.ts');
  it('the route reads the bundle once and nothing else', () => {
    expect(route.match(/readPublicProfileBundle\(/g)?.length).toBe(1);
    expect(route).not.toMatch(/\.from\('/);
    expect(route).not.toMatch(/fetchTrainingPrivacy/);
    expect(route).toMatch(/BundleUnavailableError/);
    expect(route).toMatch(/status: 503, headers: \{ 'Cache-Control': 'no-store' \}/);
  });
  it('the route keeps its rules: the counts formula, the statements/training split, the stranger view, the prefetched helpers', () => {
    expect(route).toMatch(/\(postsCount \|\| 0\) - \(statementsTotal \|\| 0\) - \(trainingTotal \|\| 0\)/);
    expect(route).toMatch(/!isStatementPost\(p\) && !isTrainingPost\(p\)/);
    expect(route).toMatch(/getProfileOrganizations\(supabase, profile\.id, STRANGER_VIEW, \{ membershipRows/);
    expect(route).toMatch(/buildSportSkillCards\(profile\.id, supabase, \{\}, \{/);
    expect(route).toMatch(/'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'/);
  });
  it('migration 280 carries the predicates the route used to send', () => {
    const m = read('database/migrations/280_public_profile_bundle.sql');
    expect(m).toMatch(/WHERE p\.handle = lower\(p_handle\)/);
    expect(m.match(/x\.status = 'published'/g)?.length).toBe(4); // the three counts + recent_posts
    expect(m).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.post_media m WHERE m\.post_id = x\.id\)/);
    expect(m).toMatch(/x\.round_id IS NULL AND x\.group_post_id IS NULL/);
    expect(m).toMatch(/x\.stats_data IS NULL OR x\.stats_data = '\{\}'::jsonb/);
    expect(m).toMatch(/x\.post_category = 'training' OR x\.stats_data->>'type' = 'activity'/);
    expect(m).toMatch(/LIMIT 24/);
    expect(m).toMatch(/m\.kind IN \('follow', 'roster', 'staff'\)/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.public_profile_bundle\(text\) TO service_role;/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.public_profile_bundle\(text\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/VALUES \(280, '280_public_profile_bundle\.sql'\)/);
  });
  it('the modules use the bundle\'s lines when handed them, and read otherwise', () => {
    expect(read('src/lib/sports/server/stat-line.ts')).toMatch(/ctx\.statLines\s*\?\s*statsCardFromLines\(ctx\.statLines\.slice\(0, 100\)/);
    expect(read('src/lib/sports/server/track-field.ts')).toMatch(/ctx\.statLines\s*\?\s*ctx\.statLines\.slice\(0, 200\)/);
    const idx = read('src/lib/sports/server/index.ts');
    expect(idx).toMatch(/prefetched \? Promise\.resolve\(\{ data: \{ sport: prefetched\.sport \} \}\)/);
    expect(idx).toMatch(/const known = prefetched\?\.activity\?\.\[key\];/);
  });
});

describe('reduceMembershipRows (the pure half of profileMembershipRows)', () => {
  const now = Date.parse('2026-10-26T00:00:00Z');
  it('a dual-edge profile reduces to its max ladder role', () => {
    expect(reduceMembershipRows([
      { org_id: 'o1', role: 'member', kind: 'follow', scope_type: 'org' },
      { org_id: 'o1', role: 'manager', kind: 'roster', scope_type: 'org' },
    ], now)).toEqual([{ orgId: 'o1', role: 'manager' }]);
  });
  it('owner/manager beat staff; an admin staff row reads admin; a plain staff row reads staff', () => {
    expect(reduceMembershipRows([{ org_id: 'o1', role: 'owner', kind: 'roster', scope_type: 'org' }, { org_id: 'o1', role: 'admin', kind: 'staff', scope_type: 'org' }], now)).toEqual([{ orgId: 'o1', role: 'owner' }]);
    expect(reduceMembershipRows([{ org_id: 'o2', role: 'admin', kind: 'staff', scope_type: 'org' }], now)).toEqual([{ orgId: 'o2', role: 'admin' }]);
    expect(reduceMembershipRows([{ org_id: 'o3', role: 'staff', kind: 'staff', scope_type: 'division' }], now)).toEqual([{ orgId: 'o3', role: 'staff' }]);
  });
  it('an expired staff row is inert; a division-scope ladder row does not count; a null org id is skipped', () => {
    expect(reduceMembershipRows([{ org_id: 'o4', role: 'staff', kind: 'staff', scope_type: 'org', expires_at: '2026-10-01T00:00:00Z' }], now)).toEqual([]);
    expect(reduceMembershipRows([{ org_id: 'o5', role: 'member', kind: 'follow', scope_type: 'division' }], now)).toEqual([]);
    expect(reduceMembershipRows([{ org_id: null, role: 'member', kind: 'follow', scope_type: 'org' }], now)).toEqual([]);
  });
});
