import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isUnclaimed, parseDecision, parseFor, parseListed, unclaimedName, unclaimedOpen } from '../unclaimed';

/**
 * Unclaimed profiles (Sprint 4 PR 6b, migration 312). Tom, Nov 15 2026: a
 * tagged player who has not claimed their profile has a page marked
 * "Unclaimed", and claiming is a request the person starts from it.
 */
const stub = { email: '11111111-2222-3333-4444-555555555555@stubs.invalid', departed_at: null };
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('who is unclaimed, and whose page is open', () => {
  it('a placeholder is an account on the reserved stub domain that is still here', () => {
    expect(isUnclaimed(stub)).toBe(true);
    expect(isUnclaimed({ ...stub, email: stub.email.toUpperCase() })).toBe(true);
    expect(isUnclaimed({ email: 'sam@example.com', departed_at: null })).toBe(false);
    expect(isUnclaimed({ email: 'kid@minors.invalid', departed_at: null })).toBe(false); // a supervised minor is claimed
    expect(isUnclaimed({ ...stub, departed_at: '2026-11-01T00:00:00Z' })).toBe(false);
    expect(isUnclaimed({ email: null, departed_at: null })).toBe(false);
    expect(isUnclaimed(null)).toBe(false);
  });
  it('the page is open unless the organization keeps it private', () => {
    expect(unclaimedOpen(stub, false)).toBe(true);
    expect(unclaimedOpen(stub, true)).toBe(false);
    expect(unclaimedOpen({ email: 'sam@example.com', departed_at: null }, false)).toBe(false);
  });
  it('the name it shows is a first name and an initial — never the full name', () => {
    expect(unclaimedName({ first_name: 'Sam', last_name: 'Keeper' })).toBe('Sam K.');
    expect(unclaimedName({ full_name: 'Sam van der Keeper' })).toBe('Sam V.');
    expect(unclaimedName({ display_name: 'Sam' })).toBe('Sam');
    expect(unclaimedName({ first_name: ' ', last_name: null, full_name: null })).toBe('Player');
    expect(unclaimedName({ first_name: 'Sam', last_name: 'Keeper' })).not.toContain('Keeper');
  });
});

describe('what the routes take', () => {
  it('a decision is approve or decline', () => {
    expect(parseDecision({ action: 'approve' })).toEqual({ ok: true, action: 'approve' });
    expect(parseDecision({ action: 'decline' })).toEqual({ ok: true, action: 'decline' });
    expect(parseDecision({ action: 'maybe' }).ok).toBe(false);
    expect(parseDecision(null).ok).toBe(false);
  });
  it('the switch is a yes or a no', () => {
    expect(parseListed({ listed: false })).toEqual({ ok: true, listed: false });
    expect(parseListed({ listed: 'no' }).ok).toBe(false);
  });
  it('`for` is a profile id or absent — never guessed', () => {
    expect(parseFor(null)).toEqual({ ok: true, forId: null });
    expect(parseFor('')).toEqual({ ok: true, forId: null });
    expect(parseFor('11111111-2222-3333-4444-555555555555')).toEqual({ ok: true, forId: '11111111-2222-3333-4444-555555555555' });
    expect(parseFor('me').ok).toBe(false);
  });
});

describe('the wiring', () => {
  it('the rules import nothing; the open-page reads never import the video modules (no cycle with videos-server)', () => {
    expect(read('src/lib/sport-profile/unclaimed.ts')).not.toMatch(/^import /m);
    const open = read('src/lib/sport-profile/unclaimed-open-server.ts');
    expect(open).not.toMatch(/from '@\/lib\/videos\//);
    expect(read('src/lib/videos/videos-server.ts')).toContain("from '@/lib/sport-profile/unclaimed-open-server'");
  });
  it('the sport profile lets a signed-in visitor into an open unclaimed page, and a block still closes it', () => {
    const gate = read('src/lib/sport-profile/sport-profile-server.ts');
    expect(gate).toMatch(/const unclaimed = !canView && !!user && \(await unclaimedPageOpen\(admin, profileId\)\);/);
    expect(gate).toMatch(/if \(!canView && !unclaimed\) return null;\s+if \(await blockedFromProfile\(admin, user\?\.id \?\? null, profileId\)\) return null;/);
  });
  it('a database without 312 opens nothing', () => {
    const open = read('src/lib/sport-profile/unclaimed-open-server.ts');
    expect(open).toMatch(/if \(error\) return true;/);
    expect(open).toMatch(/if \(closedError\) return out;/);
  });
  it('approval moves the film through the one writer that already links a placeholder, on the deciding organization\'s videos only', () => {
    const w = read('src/lib/sport-profile/unclaimed-server.ts');
    expect(w).toContain("linkTagTarget(admin, { orgId: req.org_id, profileId: null }, { kind: 'placeholder', profileId }, req.requester_profile_id, byUserId, { checkWho: false })");
    expect(w).toMatch(/if \(!access\?\.canManage\) return \{ ok: false, status: 404, error: 'Request not found' \};/);
    expect(w).toMatch(/\.eq\('id', req\.id\)\.eq\('status', 'pending'\)/);
  });
  it('the request is the athlete\'s or their guardian\'s, through the one acting-as gate', () => {
    expect(read('src/app/api/profile/[profileId]/claim-request/route.ts')).toMatch(/resolveActingProfile\(user\.id, asked\.forId, /);
  });
  it('migration 312: two tables, posture A, the grants in the file, one open request per person per placeholder, the ledger row', () => {
    const sql = read('database/migrations/312_unclaimed_profiles.sql');
    expect(sql).toContain("IF n < 311 THEN RAISE EXCEPTION '312 pre-flight: ledger head is %, expected 311', n; END IF;");
    for (const t of ['profile_claim_requests', 'unclaimed_page_private']) {
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT ALL ON TABLE public.${t} TO service_role;`);
    }
    expect(sql).toMatch(/profile_claim_requests_open_uidx ON public\.profile_claim_requests \(profile_id, requester_profile_id\) WHERE status = 'pending'/);
    expect(sql).toContain("VALUES (312, '312_unclaimed_profiles.sql') ON CONFLICT (number) DO NOTHING;");
    const policy = read('src/lib/account-departure.ts');
    for (const k of ['profile_claim_requests.profile_id', 'profile_claim_requests.requester_profile_id', 'unclaimed_page_private.profile_id']) expect(policy).toContain(`'${k}': 'goes',`);
    expect(read('src/lib/account-deletion.ts')).toContain("await mustDelete('profile_claim_requests', 'requester_profile_id');");
  });
});
