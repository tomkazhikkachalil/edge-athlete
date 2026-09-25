import { describe, it, expect } from 'vitest';
import {
  CONSENT_METHOD_CLOSING,
  CONSENT_POLICY_VERSION,
  CONSENT_STATEMENT,
  CONSENT_STATEMENT_CORE,
  CONSENT_STATEMENT_CORE_V2,
  consentStatementFor,
  parseConsentMethod,
} from '../consent';
import { signatureCardLines } from '../consent-signature';
import { MASKED_CONSENT_VERSIONS } from '../account-departure';

describe('parseConsentMethod', () => {
  it('accepts exactly the three offered methods', () => {
    expect(parseConsentMethod('signed_form')).toBe('signed_form');
    expect(parseConsentMethod('typed_signature')).toBe('typed_signature');
    expect(parseConsentMethod('drawn_signature')).toBe('drawn_signature');
  });

  it('rejects everything else — incl. DB-only designated-upgrade values', () => {
    for (const bad of ['card_charge', 'id_verification', 'video_call', 'email_plus', '', 'SIGNED_FORM', null, undefined, 42]) {
      expect(parseConsentMethod(bad)).toBeNull();
    }
  });
});

describe('consentStatementFor', () => {
  it('every statement = core + its own closing, versioned v3', () => {
    for (const method of ['signed_form', 'typed_signature', 'drawn_signature'] as const) {
      const statement = consentStatementFor(method);
      expect(statement.startsWith(CONSENT_STATEMENT_CORE)).toBe(true);
      expect(statement.endsWith(CONSENT_METHOD_CLOSING[method])).toBe(true);
      expect(statement).toContain(CONSENT_POLICY_VERSION);
      expect(CONSENT_POLICY_VERSION).toBe('minors-consent-v3');
    }
  });

  it('closings are distinct and name their mechanism', () => {
    expect(CONSENT_METHOD_CLOSING.signed_form).toContain('upload');
    expect(CONSENT_METHOD_CLOSING.typed_signature).toContain('type your full legal name');
    expect(CONSENT_METHOD_CLOSING.drawn_signature).toContain('sign in the box');
    expect(new Set(Object.values(CONSENT_METHOD_CLOSING)).size).toBe(3);
  });

  it('back-compat CONSENT_STATEMENT is the signed_form variant', () => {
    expect(CONSENT_STATEMENT).toBe(consentStatementFor('signed_form'));
  });
});

describe('signatureCardLines', () => {
  it('header carries the policy version; footer carries signer + date', () => {
    const { header, footer } = signatureCardLines({
      guardianEmail: 'parent@example.com',
      dateIso: '2026-08-28',
    });
    expect(header[0]).toContain(CONSENT_POLICY_VERSION);
    expect(footer).toBe('Signed by parent@example.com · 2026-08-28');
  });
});

// Departed accounts (Sep 24 2026): v3 tells the guardian that results with
// other players stay under "Athlete"; the version the engine masks on is the
// version the guardian signs — the two must never drift apart.
describe('consent v3 and the departure engine agree', () => {
  it('the current version is one the engine masks on, and says so in words', () => {
    expect(MASKED_CONSENT_VERSIONS).toContain(CONSENT_POLICY_VERSION);
    expect(CONSENT_STATEMENT_CORE).toContain('under the name "Athlete"');
  });
  it('v2 is kept verbatim and is NOT masked (its signature promised erasure)', () => {
    expect(CONSENT_STATEMENT_CORE_V2).toContain('minors-consent-v2');
    expect(CONSENT_STATEMENT_CORE_V2).not.toContain('Athlete"');
    expect(MASKED_CONSENT_VERSIONS).not.toContain('minors-consent-v2');
  });
});

