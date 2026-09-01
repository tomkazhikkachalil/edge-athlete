import { describe, expect, it } from 'vitest';
import { canGrantPhotoConsent } from '../photo-consent';

describe('canGrantPhotoConsent — the guardian gate', () => {
  it('a supervised athlete cannot consent for themselves', () => {
    expect(
      canGrantPhotoConsent({ actorIsSelf: true, actorIsGuardian: false, subjectSupervised: true })
    ).toBe(false);
  });

  it('a guardian consents for a supervised athlete', () => {
    expect(
      canGrantPhotoConsent({ actorIsSelf: false, actorIsGuardian: true, subjectSupervised: true })
    ).toBe(true);
  });

  it('an unsupervised (adult) athlete self-consents', () => {
    expect(
      canGrantPhotoConsent({ actorIsSelf: true, actorIsGuardian: false, subjectSupervised: false })
    ).toBe(true);
  });

  it('a guardian may also act for an unsupervised athlete (household seats)', () => {
    expect(
      canGrantPhotoConsent({ actorIsSelf: false, actorIsGuardian: true, subjectSupervised: false })
    ).toBe(true);
  });

  it('a third party (org manager, stranger) never grants', () => {
    expect(
      canGrantPhotoConsent({ actorIsSelf: false, actorIsGuardian: false, subjectSupervised: false })
    ).toBe(false);
    expect(
      canGrantPhotoConsent({ actorIsSelf: false, actorIsGuardian: false, subjectSupervised: true })
    ).toBe(false);
  });
});
