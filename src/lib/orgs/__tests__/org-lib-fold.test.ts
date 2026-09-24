import { describe, it, expect } from 'vitest';
import { ORG_KINDS, NOTIFY_ORG_KEY } from '../org-ref';
import { orgCreateSchema, orgRequestSchema, OrgRequestDecisionSchema, OrgUpdateSchema, placeToOrgColumns } from '../validate';
import {
  notifyOrgJoin, notifyOrgRole, notifyOrgRequestResult, notifyOrgRosterOffer, notifyOrgRosterResult,
  notifyOrgRosterRemoved, notifyOrgJoinRequest, notifyOrgJoinDecision, orgNotifyTypes,
} from '../notify';
import { createOrgWithOwner, ORG_CAPABILITY_DEFAULTS } from '../create';

// Round 5 step E: the league / club library pairs fold into one module each.
// These pins say what the KIND decides — and that nothing else differs.

const OWNER = '11111111-1111-4111-8111-111111111111';
const PLACE = { placeId: '22222222-2222-4222-8222-222222222222', city: 'Kanata', region: 'Ontario', regionCode: 'ON', country: 'Canada', countryCode: 'CA', lat: 45.3, lng: -75.9, label: 'Kanata, ON' };

describe.each(ORG_KINDS)('validators — %s', kind => {
  it('creation: a league needs its one sport, a club has no sport field', () => {
    const base = { name: 'QA Org', description: 'A place to play', ownerProfileId: OWNER, place: PLACE }; // optionalText takes a string or '' — never null
    const withSport = orgCreateSchema(kind).safeParse({ ...base, sportKey: 'golf' });
    const without = orgCreateSchema(kind).safeParse(base);
    expect(withSport.success).toBe(true);
    expect(without.success).toBe(kind === 'club');
    if (withSport.success) expect('sportKey' in withSport.data).toBe(kind === 'league');
  });
  it('a request strips a client-sent ownerProfileId', () => {
    const parsed = orgRequestSchema(kind).safeParse({ name: 'QA', sportKey: 'golf', ownerProfileId: OWNER });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect('ownerProfileId' in parsed.data).toBe(false);
  });
});

describe('the shared validators', () => {
  it('a decline needs a reason; an approve does not', () => {
    expect(OrgRequestDecisionSchema.safeParse({ requestId: OWNER, decision: 'decline' }).success).toBe(false);
    expect(OrgRequestDecisionSchema.safeParse({ requestId: OWNER, decision: 'decline', reason: 'no' }).success).toBe(true);
    expect(OrgRequestDecisionSchema.safeParse({ requestId: OWNER, decision: 'approve' }).success).toBe(true);
  });
  it('the update schema strips a sport and a capability flag', () => {
    const parsed = OrgUpdateSchema.parse({ name: 'X', sportKey: 'golf', operates_teams: true, joinPolicy: 'approval' });
    expect(parsed).toEqual({ name: 'X', joinPolicy: 'approval' });
  });
  it('placeToOrgColumns: NULLs when cleared, the nine columns when picked', () => {
    expect(placeToOrgColumns(null)).toMatchObject({ place_id: null, city: null, location_source: null });
    expect(placeToOrgColumns(PLACE)).toMatchObject({ place_id: PLACE.placeId, city: 'Kanata', region_code: 'ON', lat: 45.3, location_source: 'user' });
  });
});

/** An admin whose inserts are captured and whose profile read answers a first name. */
function captureAdmin() {
  const inserts: Array<{ table: string; rows: Record<string, unknown>[] }> = [];
  const admin = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown> | Record<string, unknown>[]) {
          inserts.push({ table, rows: Array.isArray(row) ? row : [row] });
          return Promise.resolve({ error: null });
        },
        select() { return { eq() { return { maybeSingle: () => Promise.resolve({ data: { first_name: 'Alex' } }) }; } }; },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test double
  return { admin: admin as any, inserts };
}

describe.each(ORG_KINDS)('notifications — %s', kind => {
  const org = { kind, orgId: 'org-1', orgName: 'The Org' };
  const t = orgNotifyTypes(kind);
  it('the kind decides the type, the metadata key and the URL family — the copy is one text', async () => {
    const { admin, inserts } = captureAdmin();
    await notifyOrgJoin(admin, { ...org, ownerProfileId: 'owner', actorId: 'actor' });
    await notifyOrgRole(admin, { ...org, profileId: 'p', role: 'manager' });
    await notifyOrgRequestResult(admin, { kind, requesterProfileId: 'r', requestId: 'req', orgName: 'The Org', approved: false, orgId: null, reason: 'nope' });
    await notifyOrgRosterOffer(admin, { ...org, profileId: 'p' });
    await notifyOrgRosterResult(admin, { ...org, ownerProfileId: 'owner', actorId: 'actor', result: 'accepted' });
    await notifyOrgRosterRemoved(admin, { ...org, profileId: 'p' });
    await notifyOrgJoinRequest(admin, { ...org, managerIds: ['m1', 'm2', 'actor'], actorId: 'actor', requestId: 'req' });
    await notifyOrgJoinDecision(admin, { ...org, profileId: 'p', approved: true, requestId: 'req' });
    const rows = inserts.flatMap(i => i.rows);
    expect(inserts.every(i => i.table === 'notifications')).toBe(true);
    expect(rows.map(r => r.type)).toEqual([t.join, t.update, t.requestResult, t.update, t.update, t.update, t.join, t.join, t.update]);
    expect(t.metadataKey).toBe(NOTIFY_ORG_KEY[kind]);
    for (const r of rows) {
      const meta = r.metadata as Record<string, unknown>;
      if (r.type !== t.requestResult) expect(meta[t.metadataKey]).toBe('org-1');
      expect(String(r.action_url)).toMatch(new RegExp(`^/(app/org/)?${kind}/`));
    }
    expect(rows[0].title).toBe('Alex joined The Org');
    expect(rows[2].action_url).toBe(`/${kind}/start`);
    expect(rows[6].action_url).toBe(`/app/org/${kind}/org-1#roster`);
    // the actor is never told about their own request; duplicates collapse
    expect(rows.filter(r => r.type === t.join && (r.metadata as { join_request?: boolean }).join_request)).toHaveLength(2);
  });
  it('an orphaned org or a self-join is quiet', async () => {
    const { admin, inserts } = captureAdmin();
    await notifyOrgJoin(admin, { ...org, ownerProfileId: null, actorId: 'a' });
    await notifyOrgJoin(admin, { ...org, ownerProfileId: 'a', actorId: 'a' });
    expect(inserts).toHaveLength(0);
  });
});

/** An admin whose organizations insert answers a row and whose memberships insert can fail. */
function orgAdmin(memberError: { message: string } | null = null) {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const admin = {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          calls.push({ table, op: 'insert', payload });
          if (table === 'organizations') return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-org', name: payload.name, ...payload }, error: null }) }) };
          return Promise.resolve({ error: memberError });
        },
        delete() { calls.push({ table, op: 'delete' }); return { eq: () => Promise.resolve({ error: null }) }; },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test double
  return { admin: admin as any, calls };
}

describe.each(ORG_KINDS)('createOrgWithOwner — %s', kind => {
  it('writes organizations with the kind, the sport and the kind\'s capability defaults, then the owner row', async () => {
    const { admin, calls } = orgAdmin();
    const created = await createOrgWithOwner(admin, { kind, name: 'QA', description: null, sportKey: kind === 'league' ? 'golf' : null, ownerProfileId: OWNER, placeColumns: placeToOrgColumns(null) });
    expect('org' in created && created.org.id).toBe('new-org');
    const row = calls[0].payload as Record<string, unknown>;
    expect(calls[0].table).toBe('organizations');
    expect(row).toMatchObject({ kind, name: 'QA', owner_profile_id: OWNER, operates_competitions: ORG_CAPABILITY_DEFAULTS[kind].operatesCompetitions, operates_teams: ORG_CAPABILITY_DEFAULTS[kind].operatesTeams });
    expect('sport_key' in row).toBe(kind === 'league');
    expect(typeof row.approved_at).toBe('string');
    expect(calls[1]).toMatchObject({ table: 'memberships', op: 'insert' });
  });
  it('explicit capabilities and a pending approval pass through', async () => {
    const { admin, calls } = orgAdmin();
    await createOrgWithOwner(admin, { kind, name: 'QA', description: null, sportKey: 'golf', ownerProfileId: OWNER, placeColumns: {}, capabilities: { operatesCompetitions: true, operatesTeams: true }, approvedAt: null, listingStatus: 'unlisted' });
    expect(calls[0].payload).toMatchObject({ operates_competitions: true, operates_teams: true, approved_at: null, listing_status: 'unlisted', sport_key: 'golf' });
  });
  it('a failed owner row deletes the fresh org', async () => {
    const { admin, calls } = orgAdmin({ message: 'boom' });
    const created = await createOrgWithOwner(admin, { kind, name: 'QA', description: null, sportKey: 'golf', ownerProfileId: OWNER, placeColumns: {} });
    expect(created).toEqual({ error: 'member_failed' });
    expect(calls.at(-1)).toMatchObject({ table: 'organizations', op: 'delete' });
  });
});

