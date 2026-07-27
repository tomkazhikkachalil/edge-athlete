import { describe, it, expect } from 'vitest';
import {
  resolveProfileAction,
  type ProfileRole,
  type ProfileAction,
} from '../profile-roles';

// The full authorization matrix from the approved proposal, asserted literally.
// Rows: action; columns: owner, guardian, supervised, viewer, none(null).
const CASES: Array<[ProfileAction, boolean, boolean, boolean, boolean, boolean]> = [
  //                        owner  guard  superv viewer none
  ['read',                  true,  true,  true,  true,  false],
  ['write_content',         true,  true,  true,  false, false],
  ['publish_content',       true,  true,  false, false, false],
  ['approve_content',       true,  true,  false, false, false],
  ['manage_settings',       true,  true,  false, false, false],
  ['manage_privacy',        true,  true,  false, false, false],
  ['manage_access',         true,  true,  false, false, false],
  ['delete_profile',        true,  true,  false, false, false],
  ['initiate_transfer',     false, true,  true,  false, false],
];

const ROLES: Array<ProfileRole | null> = [
  'owner',
  'guardian',
  'supervised',
  'viewer',
  null,
];

describe('resolveProfileAction — exhaustive matrix', () => {
  for (const [action, ...expected] of CASES) {
    for (let i = 0; i < ROLES.length; i++) {
      const role = ROLES[i];
      it(`${role ?? 'none'} × ${action} → ${expected[i]}`, () => {
        expect(resolveProfileAction(role, action)).toBe(expected[i]);
      });
    }
  }

  it('undefined role denies everything', () => {
    expect(resolveProfileAction(undefined, 'read')).toBe(false);
    expect(resolveProfileAction(undefined, 'delete_profile')).toBe(false);
  });

  it('supervised cannot publish even though they can write (approval queue)', () => {
    expect(resolveProfileAction('supervised', 'write_content')).toBe(true);
    expect(resolveProfileAction('supervised', 'publish_content')).toBe(false);
  });

  it('owner has no initiate_transfer (already owns; n/a by spec)', () => {
    expect(resolveProfileAction('owner', 'initiate_transfer')).toBe(false);
  });
});
