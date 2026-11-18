import { describe, it, expect } from 'vitest';
import { EXEMPT, auditVerdict } from '../../../scripts/audit-gate-rules.mjs';

// Nov 17 2026: the advisory gate may exempt ONE named advisory that has no
// patched version and does not reach the app (Tom's two conditions: that id
// only, and it ends by itself). These pin that an exemption never widens and
// never outlives its date or the package's next release.

const via = (id: string, name: string, severity = 'high') => ({ url: `https://github.com/advisories/${id}`, name, severity, title: `${name} advisory` });
const report = (...advisories: Array<ReturnType<typeof via>>) => ({
  vulnerabilities: {
    ...Object.fromEntries(advisories.map(a => [a.name, { via: [a] }])),
    // A package that is only vulnerable through another names it as a string.
    dependent: { via: advisories.map(a => a.name) },
  },
});
const pico = EXEMPT[0];
const live = { today: pico.since, latest: { [pico.pkg]: pico.lastVulnerable } };

describe('the advisory gate', () => {
  it('holds exactly one exemption: the picomatch advisory, with a date and a version', () => {
    expect(EXEMPT.map(e => e.id)).toEqual(['GHSA-fc5q-39xc-vjpf']);
    expect(pico).toMatchObject({ pkg: 'picomatch', lastVulnerable: '4.0.7' });
    expect(pico.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No longer than a month from the day it was written.
    expect(Date.parse(pico.expires) - Date.parse(pico.since)).toBeLessThanOrEqual(31 * 24 * 60 * 60 * 1000);
  });

  it('passes a clean report', () => {
    expect(auditVerdict({ vulnerabilities: {} }, live)).toMatchObject({ ok: true, failing: [], exempted: [], lapsed: [] });
  });

  it('passes the exempted advisory while the exemption is live', () => {
    const v = auditVerdict(report(via(pico.id, pico.pkg)), live);
    expect(v.ok).toBe(true);
    expect(v.exempted.map(a => a.id)).toEqual([pico.id]);
  });

  it('fails on any other high or critical advisory, the exempted one alongside or not', () => {
    const v = auditVerdict(report(via(pico.id, pico.pkg), via('GHSA-aaaa-bbbb-cccc', 'left-pad', 'critical')), live);
    expect(v.ok).toBe(false);
    expect(v.failing.map(a => a.id)).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });

  it('fails on a different advisory in the same package', () => {
    const v = auditVerdict(report(via('GHSA-zzzz-yyyy-xxxx', pico.pkg)), live);
    expect(v.ok).toBe(false);
    expect(v.failing).toHaveLength(1);
  });

  it('fails on the same id reported against another package', () => {
    expect(auditVerdict(report(via(pico.id, 'micromatch')), live).ok).toBe(false);
  });

  it('ignores moderate and low advisories, as the gate always has', () => {
    expect(auditVerdict(report(via('GHSA-mmmm-mmmm-mmmm', 'thing', 'moderate')), live).ok).toBe(true);
  });

  it('lapses the day after it expires', () => {
    const day = new Date(Date.parse(pico.expires) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const v = auditVerdict(report(via(pico.id, pico.pkg)), { ...live, today: day });
    expect(v.ok).toBe(false);
    expect(v.lapsed[0].why).toContain('expired');
    expect(auditVerdict(report(via(pico.id, pico.pkg)), { ...live, today: pico.expires }).ok).toBe(true);
  });

  it('lapses as soon as the package has a newer release', () => {
    const v = auditVerdict(report(via(pico.id, pico.pkg)), { today: pico.since, latest: { [pico.pkg]: '4.0.8' } });
    expect(v.ok).toBe(false);
    expect(v.lapsed[0].why).toContain('4.0.8');
  });

  it('lapses when the latest release cannot be read', () => {
    expect(auditVerdict(report(via(pico.id, pico.pkg)), { today: pico.since, latest: {} }).ok).toBe(false);
  });
});
