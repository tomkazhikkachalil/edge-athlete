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
  // on the two routes that mint an org owner. A refactor that drops the call
  // re-opens the minor gap silently — hence a source assertion, the
  // api-route-authz.test.ts idiom.
  const routes = ['src/app/api/clubs/requests/route.ts', 'src/app/api/leagues/requests/route.ts'];
  for (const rel of routes) {
    it(`${rel} gates on requireOrgCreator after requireAuth`, () => {
      const source = readFileSync(join(process.cwd(), rel), 'utf8');
      const auth = source.indexOf('await requireAuth(');
      const gate = source.indexOf('await requireOrgCreator(');
      expect(auth).toBeGreaterThan(-1);
      expect(gate).toBeGreaterThan(auth);
    });
  }
});
