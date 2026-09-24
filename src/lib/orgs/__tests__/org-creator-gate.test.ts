import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { SUPERVISED_ORG_CREATOR_ERROR, canCreateOrg } from '../org-creator-gate';

describe('canCreateOrg', () => {
  it('an adult (self, or an older profile with no state) may start an org', () => {
    expect(canCreateOrg({ supervisionState: 'self' })).toEqual({ ok: true });
    expect(canCreateOrg({ supervisionState: null })).toEqual({ ok: true });
  });

  it('a supervised athlete is refused with the guardian message — 403, never a silent pass', () => {
    expect(canCreateOrg({ supervisionState: 'supervised' })).toEqual({
      ok: false,
      status: 403,
      error: SUPERVISED_ORG_CREATOR_ERROR,
    });
  });

  it('a missing profile row is a 404, not a pass', () => {
    expect(canCreateOrg({ supervisionState: undefined })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('the org-creation routes call the gate', () => {
  // The route-authz audit proves requireAuth; this proves the SECOND gate
  // on the one handler that mints an org owner (Round 5 D3: both request
  // routes are shims over orgRequestsPOST in requests-server.ts). A refactor
  // that drops the call re-opens the minor gap silently — hence a source
  // assertion, the api-route-authz.test.ts idiom; the two shims are pinned
  // to delegate there.
  const routes = ['src/lib/orgs/requests-server.ts'];
  for (const rel of ['src/app/api/clubs/requests/route.ts', 'src/app/api/leagues/requests/route.ts']) {
    it(`${rel} delegates its POST to orgRequestsPOST`, () => {
      const source = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(source).toMatch(/return await orgRequestsPOST\(request, '(league|club)'\)/);
    });
  }
  for (const rel of routes) {
    it(`${rel} gates on requireOrgCreator after requireAuth`, () => {
      const source = readFileSync(join(process.cwd(), rel), 'utf8');
      // Since Spec 2 the creation POST authenticates through requireActiveWriter
      // (requireAuth + the moderation write gate) — either spelling is the first gate.
      const auth = source.search(/await require(ActiveWriter|Auth)\(/);
      const gate = source.indexOf('await requireOrgCreator(');
      expect(auth).toBeGreaterThan(-1);
      expect(gate).toBeGreaterThan(auth);
    });
  }
});
