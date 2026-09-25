import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  QA_ORG_NAME_RE, QA_ORG_NAME_SQL, SWEEP_CUTOFF_MS, isQaOrgName, isQaUserEmail, isShadowEmail, isStale,
  staleQaOrgs, staleShadows,
} from '../../../e2e/helpers/qa-sweep-rules';

// The e2e sweep's rules (Sep 24 2026): what a run may take from a database
// that still holds real data — proven here on the shapes that must be
// admitted and the ones that must be refused.

const NOW = Date.parse('2026-09-24T12:00:00Z');
const CUTOFF = NOW - SWEEP_CUTOFF_MS;
const old = new Date(NOW - 25 * 3600_000).toISOString();
const fresh = new Date(NOW - 3600_000).toISOString();

describe('the QA org name', () => {
  it('admits the shape every spec mints and refuses everything near it', () => {
    expect(isQaOrgName('QA Aff League 1790223560574')).toBe(true);
    expect(isQaOrgName('QA Two Pages Club 1790224360574')).toBe(true);
    expect(isQaOrgName('Quality Athletics')).toBe(false);
    expect(isQaOrgName('QA League')).toBe(false);          // no epoch
    expect(isQaOrgName('QA X 17902235')).toBe(false);      // a short number
    expect(isQaOrgName('QA X 17902235605741')).toBe(false); // too long
    expect(isQaOrgName('Kanata QA League 1790223560574')).toBe(false); // not a prefix
    expect(isQaOrgName(null)).toBe(false);
  });
  it('the SQL twin in the bulk script is the same rule', () => {
    expect(QA_ORG_NAME_SQL).toBe('^QA .* [0-9]{13}$');
    expect(QA_ORG_NAME_RE.source).toBe('^QA .* \\d{13}$');
    const script = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'staging-sweep.mjs'), 'utf8');
    expect(script).toContain(QA_ORG_NAME_SQL);
  });
});

describe('users and shadows', () => {
  it('recognises the e2e users and the shadow users', () => {
    expect(isQaUserEmail('edgeqa-fzdprvdk@example.com')).toBe(true);
    expect(isQaUserEmail('edgeqa-fzdprvdk@example.org')).toBe(false);
    expect(isQaUserEmail('tom@example.com')).toBe(false);
    expect(isShadowEmail('80c622ed-2ecb-4852-b35b-85efdfd5960f@stubs.invalid')).toBe(true);
    expect(isShadowEmail('pending-ab12@minors.invalid')).toBe(true);
    expect(isShadowEmail('seed-0001@staging.invalid')).toBe(false);
  });
  it('the age rule is the cutoff, inclusive', () => {
    expect(isStale(old, CUTOFF)).toBe(true);
    expect(isStale(fresh, CUTOFF)).toBe(false);
  });
});

describe('the org rule — three clauses, each proven by the org it leaves', () => {
  const stale = new Set(['stale-user']);
  const rows = [
    { id: 'take', name: 'QA Sweep 1790223560574', created_at: old, owner_profile_id: null },
    { id: 'take-2', name: 'QA Sweep 1790223560575', created_at: old, owner_profile_id: 'stale-user' },
    { id: 'live-owner', name: 'QA Sweep 1790223560576', created_at: old, owner_profile_id: 'tom' },
    { id: 'too-young', name: 'QA Sweep 1790223560577', created_at: fresh, owner_profile_id: null },
    { id: 'real-name', name: 'Kanata Minor Hockey', created_at: old, owner_profile_id: null },
  ];
  it('takes exactly the QA-named, old, ownerless-or-QA-owned orgs', () => {
    expect(staleQaOrgs(rows, CUTOFF, stale).map(o => o.id)).toEqual(['take', 'take-2']);
  });
});

describe('the shadow rule — a live holder protects the profile', () => {
  const stale = new Set(['stale-guardian']);
  const shadows = [
    { id: 'orphan-stub', email: 'orphan-stub@stubs.invalid', created_at: old },
    { id: 'qa-minor', email: 'qa-minor@minors.invalid', created_at: old },
    { id: 'real-minor', email: 'real-minor@minors.invalid', created_at: old },
    { id: 'young-stub', email: 'young-stub@stubs.invalid', created_at: fresh },
  ];
  const access = [
    { profile_id: 'orphan-stub', user_id: 'orphan-stub' },      // a stub's own row
    { profile_id: 'qa-minor', user_id: 'stale-guardian' },      // a stale QA guardian
    { profile_id: 'real-minor', user_id: 'stale-guardian' },
    { profile_id: 'real-minor', user_id: 'tom' },               // a live second guardian
    { profile_id: 'young-stub', user_id: 'young-stub' },
  ];
  it('takes the orphaned stub and the QA minor; keeps the minor with a live guardian and anything young', () => {
    expect(staleShadows(shadows, access, CUTOFF, stale).map(s => s.id)).toEqual(['orphan-stub', 'qa-minor']);
  });
});
