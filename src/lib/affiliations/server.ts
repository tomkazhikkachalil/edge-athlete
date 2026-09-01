// ── Affiliation handlers — the shared core (118) ────────────────────────────
// Both routes (/api/leagues/[id]/clubs and /api/clubs/[id]/leagues) are thin
// wrappers over these four functions, so the AUTHORIZATION MATRIX lives in
// exactly one place:
//
//   Row state                     | Caller is owner/manager of… | Result
//   ------------------------------|-----------------------------|---------------------------
//   none                          | —                           | 404
//   pending, caller on initiating | the initiating org          | DELETE = withdraw (quiet)
//   pending, caller on opposite   | the receiving org           | DELETE = decline (notify)
//   pending, PATCH accept, caller | the receiving org           | accept (status → active)
//     on the OPPOSITE side        |                             |
//   pending, PATCH accept, caller | the initiating org          | 403 — you can't accept
//     on the initiating side      |                             |   your own invite
//   active, caller on either side | either org                  | DELETE = dissolve (notify)
//   any, plain member/non-member  | —                           | 403
//
// The accept side derives from row.initiated_by, NEVER from which route was
// called — both routes can accept, and both refuse self-acceptance.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getOrgRole, isOwnerOrManager } from '@/lib/orgs/authz';
import { profileMembershipRows } from '@/lib/orgs/members';
import { isMissingTableError } from '@/lib/leagues/validate';
import type { AffiliationType } from './validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

export type AffSide = 'league' | 'club';

interface SideConfig {
  side: AffSide;
  otherSide: AffSide;
  orgTable: 'leagues' | 'clubs';
  rowKey: 'league_id' | 'club_id';
  otherRowKey: 'league_id' | 'club_id';
  otherOrgTable: 'leagues' | 'clubs';
  pagePath: (id: string) => string;
  otherPagePath: (id: string) => string;
}

const SIDES: Record<AffSide, SideConfig> = {
  league: {
    side: 'league',
    otherSide: 'club',
    orgTable: 'leagues',
    rowKey: 'league_id',
    otherRowKey: 'club_id',
    otherOrgTable: 'clubs',
    pagePath: id => `/league/${id}`,
    otherPagePath: id => `/club/${id}`,
  },
  club: {
    side: 'club',
    otherSide: 'league',
    orgTable: 'clubs',
    rowKey: 'club_id',
    otherRowKey: 'league_id',
    otherOrgTable: 'leagues',
    pagePath: id => `/club/${id}`,
    otherPagePath: id => `/league/${id}`,
  },
};

interface OrgRow {
  id: string;
  name: string;
  owner_profile_id: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin client alias
type Admin = any;

async function loadOrg(
  admin: Admin,
  table: 'leagues' | 'clubs',
  id: string
): Promise<{ org: OrgRow | null; missing: boolean }> {
  const { data, error } = await admin
    .from(table)
    .select('id, name, owner_profile_id')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error.code)) return { org: null, missing: true };
    console.error(`[AFFILIATIONS] ${table} fetch error:`, error);
    return { org: null, missing: false };
  }
  return { org: (data as OrgRow) ?? null, missing: false };
}

/** Names in (leagueName, clubName) order regardless of side. */
function orgNames(cfg: SideConfig, org: OrgRow, other: OrgRow) {
  return cfg.side === 'league'
    ? { leagueName: org.name, clubName: other.name }
    : { leagueName: other.name, clubName: org.name };
}

/** The other-side org decoration on an affiliation row. Leagues carry a
 *  sport_key; clubs don't (the 118 select difference). */
export interface AffiliatedOrg {
  id: string;
  name: string;
  sport_key?: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

export interface DecoratedAffiliationRow {
  league_id: string;
  club_id: string;
  status: string;
  initiated_by: AffSide;
  requested_by_profile_id: string | null;
  created_at: string;
  affiliation_type: string | null;
  org: AffiliatedOrg | null;
}

/** All affiliation rows for an org, decorated with the other-side org —
 *  plain data, viewer-independent (phase 3 R2: the public org-site
 *  affiliations module reads the active subset through unstable_cache).
 *  `missing` = pre-118 database (empty section, never an error);
 *  null = real DB error. */
export async function listAffiliations(
  admin: Admin,
  side: AffSide,
  orgId: string
): Promise<{ rows: DecoratedAffiliationRow[]; missing: boolean } | null> {
  const cfg = SIDES[side];
  const { data: rows, error } = await admin
    .from('league_clubs')
    .select('league_id, club_id, status, initiated_by, requested_by_profile_id, created_at, affiliation_type')
    .eq(cfg.rowKey, orgId);
  if (error) {
    if (isMissingTableError(error.code)) return { rows: [], missing: true };
    console.error('[AFFILIATIONS] list error:', error);
    return null;
  }

  const list = rows ?? [];
  const otherIds = [...new Set(list.map((r: Record<string, unknown>) => r[cfg.otherRowKey] as string))];
  const selectCols = cfg.otherOrgTable === 'leagues'
    ? 'id, name, sport_key, city, region, country'
    : 'id, name, city, region, country';
  const { data: others } = otherIds.length
    ? await admin.from(cfg.otherOrgTable).select(selectCols).in('id', otherIds)
    : { data: [] };
  // The dynamic select string defeats supabase-js's type-level parser — the
  // runtime shape is the selected columns; cast once here.
  const otherRows = (others ?? []) as unknown as AffiliatedOrg[];
  const byId = new Map(otherRows.map(o => [o.id, o]));
  return {
    rows: list.map((r: Record<string, unknown>) => ({
      ...(r as unknown as Omit<DecoratedAffiliationRow, 'org'>),
      org: byId.get(r[cfg.otherRowKey] as string) ?? null,
    })),
    missing: false,
  };
}

/** GET — public actives; pending split into outgoing/incoming for managers. */
export async function affiliationGET(request: NextRequest, side: AffSide, orgId: string) {
  const cfg = SIDES[side];
  if (!UUID_RE.test(orgId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const { user } = await getServerAuth(request);
  const admin = getSupabaseAdmin();

  const { org } = await loadOrg(admin, cfg.orgTable, orgId);
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const listed = await listAffiliations(admin, side, orgId);
  if (listed === null) {
    return NextResponse.json({ error: 'Failed to load affiliations' }, { status: 500 });
  }
  if (listed.missing) {
    // Pre-118 database: an empty section, never an error.
    return NextResponse.json({ active: [], outgoing: [], incoming: [], viewerIsManager: false });
  }
  const list = listed.rows;

  const viewerRole = user
    ? await getOrgRole(admin, cfg.side, orgId, user.id)
    : null;
  const manager = isOwnerOrManager(viewerRole);

  return NextResponse.json({
    active: list.filter(r => r.status === 'active'),
    outgoing: manager
      ? list.filter(r => r.status === 'pending' && r.initiated_by === cfg.side)
      : [],
    incoming: manager
      ? list.filter(r => r.status === 'pending' && r.initiated_by === cfg.otherSide)
      : [],
    viewerIsManager: manager,
  });
}

/** POST — initiate an invite/request toward targetId. */
export async function affiliationPOST(
  request: NextRequest,
  side: AffSide,
  orgId: string,
  targetId: string,
  affiliationType: AffiliationType = 'partner_of'
) {
  const cfg = SIDES[side];
  const user = await requireAuth(request);
  const limited = await enforceRateLimit(request, 'affiliation', { userId: user.id });
  if (limited) return limited;
  if (!UUID_RE.test(orgId) || !UUID_RE.test(targetId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const admin = getSupabaseAdmin();

  const { org } = await loadOrg(admin, cfg.orgTable, orgId);
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const role = await getOrgRole(admin, cfg.side, orgId, user.id);
  if (!isOwnerOrManager(role)) {
    return NextResponse.json({ error: 'Only owners and managers can affiliate' }, { status: 403 });
  }

  const { org: other } = await loadOrg(admin, cfg.otherOrgTable, targetId);
  if (!other) {
    return NextResponse.json(
      { error: cfg.otherSide === 'club' ? 'Club not found' : 'League not found' },
      { status: 404 }
    );
  }

  const { error } = await admin.from('league_clubs').insert({
    [cfg.rowKey]: orgId,
    [cfg.otherRowKey]: targetId,
    status: 'pending',
    initiated_by: cfg.side,
    requested_by_profile_id: user.id,
    affiliation_type: affiliationType,
  });
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Already affiliated or pending' }, { status: 409 });
    }
    if (isMissingTableError(error.code)) {
      return NextResponse.json({ error: 'Affiliations are not available yet' }, { status: 503 });
    }
    console.error('[AFFILIATIONS] insert error:', error);
    return NextResponse.json({ error: 'Failed to send the invite' }, { status: 500 });
  }

  const { notifyAffiliationInvite } = await import('./notify');
  await notifyAffiliationInvite(admin, {
    recipientProfileId: other.owner_profile_id,
    ...orgNames(cfg, org, other),
    initiatedBy: cfg.side,
    affiliationType,
    // The recipient accepts from THEIR OWN page.
    actionUrl: cfg.otherPagePath(targetId),
  });

  return NextResponse.json({ ok: true, status: 'pending' });
}

/** PATCH accept — the caller must sit OPPOSITE row.initiated_by. */
export async function affiliationAccept(
  request: NextRequest,
  side: AffSide,
  orgId: string,
  targetId: string
) {
  const cfg = SIDES[side];
  const user = await requireAuth(request);
  if (!UUID_RE.test(orgId) || !UUID_RE.test(targetId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const admin = getSupabaseAdmin();

  const { org } = await loadOrg(admin, cfg.orgTable, orgId);
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const role = await getOrgRole(admin, cfg.side, orgId, user.id);
  if (!isOwnerOrManager(role)) {
    return NextResponse.json({ error: 'Only owners and managers can accept' }, { status: 403 });
  }

  const { data: row, error } = await admin
    .from('league_clubs')
    .select('league_id, club_id, status, initiated_by, requested_by_profile_id, affiliation_type')
    .eq(cfg.rowKey, orgId)
    .eq(cfg.otherRowKey, targetId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error.code)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('[AFFILIATIONS] row fetch error:', error);
    return NextResponse.json({ error: 'Failed to load the affiliation' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'Already active' }, { status: 409 });
  }
  if (row.initiated_by === cfg.side) {
    return NextResponse.json(
      { error: "Your side sent this invite — the other side accepts it" },
      { status: 403 }
    );
  }

  // Optimistic claim (the 116 pattern): zero rows = withdrawn or decided
  // mid-flight.
  const { data: claimed, error: claimError } = await admin
    .from('league_clubs')
    .update({
      status: 'active',
      decided_by_profile_id: user.id,
      decided_at: new Date().toISOString(),
    })
    .eq(cfg.rowKey, orgId)
    .eq(cfg.otherRowKey, targetId)
    .eq('status', 'pending')
    .select();
  if (claimError || !claimed || claimed.length === 0) {
    if (claimError) console.error('[AFFILIATIONS] claim error:', claimError);
    return NextResponse.json({ error: 'This invite is no longer pending' }, { status: 409 });
  }

  // Phase 6 R3: sanctioned_by accepts open a sanction_grants history row
  // (append-only audit; best-effort, pre-167-safe).
  if (row.affiliation_type === 'sanctioned_by') {
    const { recordSanctionGrant } = await import('./parents-server');
    await recordSanctionGrant(admin, row.league_id, 'club', row.club_id);
  }

  const { org: other } = await loadOrg(admin, cfg.otherOrgTable, targetId);
  if (other) {
    const { notifyAffiliationUpdate } = await import('./notify');
    await notifyAffiliationUpdate(admin, {
      recipientProfileId: row.requested_by_profile_id,
      ...orgNames(cfg, org, other),
      outcome: 'accepted',
      affiliationType: (row.affiliation_type as AffiliationType | null) ?? 'partner_of',
      actionUrl: cfg.otherPagePath(targetId),
    });
  }

  return NextResponse.json({ ok: true, status: 'active' });
}

/** DELETE — withdraw / decline / dissolve per the matrix above. */
export async function affiliationDELETE(
  request: NextRequest,
  side: AffSide,
  orgId: string,
  targetId: string
) {
  const cfg = SIDES[side];
  const user = await requireAuth(request);
  if (!UUID_RE.test(orgId) || !UUID_RE.test(targetId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const admin = getSupabaseAdmin();

  const { org } = await loadOrg(admin, cfg.orgTable, orgId);
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const role = await getOrgRole(admin, cfg.side, orgId, user.id);
  if (!isOwnerOrManager(role)) {
    return NextResponse.json({ error: 'Only owners and managers can do that' }, { status: 403 });
  }

  const { data: row, error } = await admin
    .from('league_clubs')
    .select('league_id, club_id, status, initiated_by, requested_by_profile_id, affiliation_type')
    .eq(cfg.rowKey, orgId)
    .eq(cfg.otherRowKey, targetId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error.code)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('[AFFILIATIONS] row fetch error:', error);
    return NextResponse.json({ error: 'Failed to load the affiliation' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error: deleteError } = await admin
    .from('league_clubs')
    .delete()
    .eq(cfg.rowKey, orgId)
    .eq(cfg.otherRowKey, targetId);
  if (deleteError) {
    console.error('[AFFILIATIONS] delete error:', deleteError);
    return NextResponse.json({ error: 'Failed to remove the affiliation' }, { status: 500 });
  }

  const { org: other } = await loadOrg(admin, cfg.otherOrgTable, targetId);
  const names = other ? orgNames(cfg, org, other) : null;
  const { notifyAffiliationUpdate } = await import('./notify');

  if (row.status === 'pending' && row.initiated_by === cfg.side) {
    // Withdraw — quiet cancel, no notification.
    return NextResponse.json({ action: 'withdrawn' });
  }
  if (row.status === 'pending') {
    // Decline — tell the requester.
    if (names) {
      await notifyAffiliationUpdate(admin, {
        recipientProfileId: row.requested_by_profile_id,
        ...names,
        outcome: 'declined',
        affiliationType: (row.affiliation_type as AffiliationType | null) ?? 'partner_of',
        actionUrl: cfg.otherPagePath(targetId),
      });
    }
    return NextResponse.json({ action: 'declined' });
  }
  // Active — dissolve; close the sanction-grant history for
  // sanctioned_by edges (phase 6 R3), then tell the other side's owner.
  if (row.status === 'active' && row.affiliation_type === 'sanctioned_by') {
    const { revokeSanctionGrant } = await import('./parents-server');
    await revokeSanctionGrant(admin, row.league_id, 'club', row.club_id);
  }
  if (names && other) {
    await notifyAffiliationUpdate(admin, {
      recipientProfileId: other.owner_profile_id,
      ...names,
      outcome: 'dissolved',
      affiliationType: (row.affiliation_type as AffiliationType | null) ?? 'partner_of',
      actionUrl: cfg.otherPagePath(targetId),
    });
  }
  return NextResponse.json({ action: 'dissolved' });
}

export interface ProfileOrganization {
  kind: AffSide;
  id: string;
  name: string;
  role: string;
  city: string | null;
  region: string | null;
  country: string | null;
  sport_key?: string | null;
}

/**
 * Every org a profile belongs to, with their role — the profile-first read
 * the org tables never had (they were only ever read org-first). Public
 * data by the existing membership-is-public decision: org pages already
 * list member names/avatars. Used by /api/profile/[id]/organizations and
 * the /u/ public-profile aggregate.
 */
export async function getProfileOrganizations(
  admin: Admin,
  profileId: string
): Promise<ProfileOrganization[]> {
  const out: ProfileOrganization[] = [];
  for (const side of ['league', 'club'] as const) {
    const cfg = SIDES[side];
    const { rows, error } = await profileMembershipRows(admin, side, profileId);
    if (error) {
      // Pre-140 database: an empty strip, never an error.
      if (isMissingTableError(error.code)) continue;
      console.error('[AFFILIATIONS] memberships fetch error:', error);
      continue;
    }
    if (rows.length === 0) continue;
    const orgIds = rows.map(r => r.orgId);
    const selectCols = side === 'league'
      ? 'id, name, sport_key, city, region, country'
      : 'id, name, city, region, country';
    const { data: orgs } = await admin.from(cfg.orgTable).select(selectCols).in('id', orgIds);
    const orgRows = (orgs ?? []) as unknown as Array<{
      id: string; name: string; sport_key?: string | null;
      city: string | null; region: string | null; country: string | null;
    }>;
    const byId = new Map(orgRows.map(o => [o.id, o]));
    for (const row of rows) {
      const org = byId.get(row.orgId);
      if (!org) continue;
      out.push({
        kind: side,
        id: org.id,
        name: org.name,
        role: row.role,
        city: org.city,
        region: org.region,
        country: org.country,
        ...(side === 'league' ? { sport_key: org.sport_key ?? null } : {}),
      });
    }
  }
  // Owned/managed first, then alphabetical — the strip's display order.
  const rank: Record<string, number> = { owner: 0, manager: 1, member: 2 };
  out.sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.name.localeCompare(b.name));
  return out;
}
