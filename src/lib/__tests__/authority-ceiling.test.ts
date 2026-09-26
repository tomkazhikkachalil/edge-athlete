import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Authority PR 3 (Sep 25 2026) — Tom: a limited, suspended or banned account
// loses its org and event authority automatically. The ceiling lives in the
// FOUR reads every org / event gate goes through, so no route is edited one
// by one — this test holds each of them to applying it.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('the moderation ceiling sits at every choke point', () => {
  it('getOrgRole and getOrgCapabilities apply it (orgs/authz.ts)', () => {
    const src = read('src/lib/orgs/authz.ts');
    const role = src.slice(src.indexOf('export async function getOrgRole'), src.indexOf('export function roleCeiling'));
    expect(role).toMatch(/readActorHoldsAuthority\(/);
    expect(role).toMatch(/roleCeiling\(/);
    const caps = src.slice(src.indexOf('export async function getOrgCapabilities'), src.indexOf('export type OrgAndRole'));
    expect(caps).toMatch(/readActorHoldsAuthority\(/);
    expect(caps).toMatch(/authorityCeiling\(/);
  });
  it('the org page preview applies it (orgs/members.ts)', () => {
    expect(read('src/lib/orgs/members.ts')).toMatch(/roleCeiling\(maxOrgRole\(/);
  });
  it('the event gate reads the viewer and passes viewerHoldsAuthority (sport-events/access-server.ts)', () => {
    const src = read('src/lib/sport-events/access-server.ts');
    expect(src).toMatch(/readActorHoldsAuthority\(admin, viewerId\)/);
    expect(src).toMatch(/viewerHoldsAuthority,/);
  });
  it('the scoring gate applies it (sport-events/scoring-authz-server.ts)', () => {
    const src = read('src/lib/sport-events/scoring-authz-server.ts');
    expect(src).toMatch(/const holdsP = readActorHoldsAuthority\(admin, viewerId\)/);
    expect(src).toMatch(/const holds = await holdsP/);
    expect(src).toMatch(/eventRole: ceiledRole/);
  });
});
