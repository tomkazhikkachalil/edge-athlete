import { describe, it, expect } from 'vitest';
import {
  resolveActingProfile,
  CONSENT_REQUIRED_MESSAGE,
  type ActingGateIO,
} from '../guardian-gate';

// FEATURE_FLAGS reads process.env at module load, and guardian-gate imports
// the features module lazily (at call time). Vitest isolates module
// registries per test file, so pinning the env here — before any gate call —
// deterministically turns the flag ON for this file regardless of the
// runner's environment.
process.env.NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES = '1';

const USER = 'user-1';
const CHILD = 'child-1';
const ROLE_ERROR = 'You do not have permission to post to this profile';

function io(role: string | null, consent: string): ActingGateIO {
  return {
    getRole: async () => role,
    getConsent: async () => consent,
  };
}

const neverCalled: ActingGateIO = {
  getRole: async () => { throw new Error('getRole must not be called'); },
  getConsent: async () => { throw new Error('getConsent must not be called'); },
};

describe('resolveActingProfile', () => {
  it('no target → self, not acting, no lookups made', async () => {
    expect(await resolveActingProfile(USER, null, ROLE_ERROR, neverCalled))
      .toEqual({ ok: true, actorId: USER, actingAs: false });
    expect(await resolveActingProfile(USER, undefined, ROLE_ERROR, neverCalled))
      .toEqual({ ok: true, actorId: USER, actingAs: false });
  });

  it('target === self → self, NOT acting (the comments moderation-bypass shape)', async () => {
    expect(await resolveActingProfile(USER, USER, ROLE_ERROR, neverCalled))
      .toEqual({ ok: true, actorId: USER, actingAs: false });
  });

  it('non-guardian → 403 with the caller-supplied copy', async () => {
    expect(await resolveActingProfile(USER, CHILD, ROLE_ERROR, io(null, 'approved')))
      .toEqual({ ok: false, status: 403, error: ROLE_ERROR });
    // 'supervised' and 'self' roles are equally rejected — guardian only.
    expect(await resolveActingProfile(USER, CHILD, ROLE_ERROR, io('supervised', 'approved')))
      .toEqual({ ok: false, status: 403, error: ROLE_ERROR });
    expect(await resolveActingProfile(USER, CHILD, ROLE_ERROR, io('self', 'approved')))
      .toEqual({ ok: false, status: 403, error: ROLE_ERROR });
  });

  it('guardian without approved consent → 403 with the shared verbatim copy', async () => {
    for (const consent of ['none', 'pending_review', 'rejected', 'withdrawn']) {
      expect(await resolveActingProfile(USER, CHILD, ROLE_ERROR, io('guardian', consent)))
        .toEqual({ ok: false, status: 403, error: CONSENT_REQUIRED_MESSAGE });
    }
  });

  it('guardian + approved consent → acting as the child', async () => {
    expect(await resolveActingProfile(USER, CHILD, ROLE_ERROR, io('guardian', 'approved')))
      .toEqual({ ok: true, actorId: CHILD, actingAs: true });
  });

  it('the consent copy is the byte-identical string probes assert', () => {
    expect(CONSENT_REQUIRED_MESSAGE).toBe(
      'Parental consent must be approved before anything can be posted to this profile.'
    );
  });
});
