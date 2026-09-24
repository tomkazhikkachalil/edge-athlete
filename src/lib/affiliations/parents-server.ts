// ── League↔league affiliations — the chain's edge (phase 6 R3, mig 167) ─────
// The 118 authorization matrix VERBATIM over the league→league rows of
// `affiliations` (Round 5 D-ii, 236: org_id = the child league,
// parent_org_id = the parent; the API keeps speaking league_id /
// parent_league_id — `publicParentEdge` is the one translation)
// (child league → parent league): either side's owner/manager initiates,
// the opposite side accepts, DELETE is withdraw/decline/dissolve by row
// state. One route serves it (/api/leagues/[id]/parents) — the [id] is
// ALWAYS the child league; the parent is addressed in body/query.
//
// INVARIANT (143, re-asserted): affiliation grants NOTHING. A parent
// league gains no authority over the child's data, results or roster —
// sanctioning affects display/provenance only.
//
// sanctioned_by edges write the append-only `sanction_grants` history on
// accept (insert) and dissolve (revoked_at) — best-effort, pre-167-safe.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getOrgRole, isOwnerOrManager } from '@/lib/orgs/authz';
import { isMissingTableError } from '@/lib/orgs/validate';
import type { AffiliationType } from './validate';
import { UUID_RE } from '@/lib/golf/course-catalog';
import type { OrgKind } from '@/lib/orgs/org-ref';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin client alias (the server.ts pattern)
type Admin = any;

interface LeagueRow {
  id: string;
  name: string;
  owner_profile_id: string | null;
}

async function loadLeague(admin: Admin, id: string): Promise<LeagueRow | null> {
  const { data, error } = await admin
    .from('organizations')
    .select('id, name, owner_profile_id')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[PARENTS] league fetch error:', error);
    return null;
  }
  return (data as LeagueRow) ?? null;
}

// ── The grants history (shared with the league_clubs hooks) ─────────────────

/** Open a grant row on a sanctioned_by accept. Best-effort: a pre-167
 *  target (missing table) is silent — the handshake must never break on
 *  the audit record. */
export async function recordSanctionGrant(
  admin: Admin,
  grantorLeagueId: string,
  granteeKind: OrgKind,
  granteeId: string
): Promise<void> {
  try {
    // 237: the org columns are the columns (grantor_league_id / grantee_kind /
    // grantee_id are gone — an insert naming them is a PGRST204 that this
    // best-effort path would swallow, which is how the 237 probe found the
    // dual-write still in place).
    const { error } = await admin.from('sanction_grants').insert({
      grantor_org_id: grantorLeagueId,
      grantee_org_id: granteeId,
    });
    void granteeKind; // the kind is the org's now (236); the parameter stays for the callers
    if (error && !isMissingTableError(error.code)) {
      console.error('[PARENTS] grant insert error:', error);
    }
  } catch {
    // best-effort
  }
}

/** Close the open grant on dissolve. Append-only: revoked_at is stamped,
 *  the row never deleted. */
export async function revokeSanctionGrant(
  admin: Admin,
  grantorLeagueId: string,
  granteeKind: OrgKind,
  granteeId: string
): Promise<void> {
  try {
    const { error } = await admin
      .from('sanction_grants')
      .update({ revoked_at: new Date().toISOString() })
      .eq('grantor_org_id', grantorLeagueId)
      .eq('grantee_org_id', granteeId)
      .is('revoked_at', null);
    void granteeKind; // the kind is the org's now (236); the parameter stays for the callers
    if (error && !isMissingTableError(error.code)) {
      console.error('[PARENTS] grant revoke error:', error);
    }
  } catch {
    // best-effort
  }
}

// ── The four handlers ───────────────────────────────────────────────────────

const PARENT_EDGE_SELECT = 'org_id, parent_org_id, status, initiated_by, requested_by_profile_id, created_at, affiliation_type';
/** Only league→league rows: a league's CLUB children (the affiliations
 *  section) are filtered out through the child's kind. */
const PARENT_EDGE_SELECT_WITH_CHILD_KIND = `${PARENT_EDGE_SELECT}, child:organizations!affiliations_org_id_fkey!inner(kind)`;

interface ParentEdgeRaw {
  org_id: string;
  parent_org_id: string;
  status: string;
  initiated_by: 'child' | 'parent';
  requested_by_profile_id: string | null;
  created_at: string;
  affiliation_type: string | null;
}

/** A stored edge as the API speaks it (league_id = the child). */
function publicParentEdge(r: ParentEdgeRaw): Omit<ParentAffiliationRow, 'org'> {
  return {
    league_id: r.org_id,
    parent_league_id: r.parent_org_id,
    status: r.status,
    initiated_by: r.initiated_by,
    requested_by_profile_id: r.requested_by_profile_id,
    created_at: r.created_at,
    affiliation_type: r.affiliation_type,
  };
}

/** The (child, parent) pair a route names, in EITHER direction. */
function eitherDirection(a: string, b: string): string {
  return `and(org_id.eq.${a},parent_org_id.eq.${b}),and(org_id.eq.${b},parent_org_id.eq.${a})`;
}

export interface ParentAffiliationRow {
  league_id: string;
  parent_league_id: string;
  status: string;
  initiated_by: 'child' | 'parent';
  requested_by_profile_id: string | null;
  created_at: string;
  affiliation_type: string | null;
  /** The OTHER league relative to the viewed one. */
  org: { id: string; name: string; sport_key?: string | null; city: string | null; region: string | null; country: string | null } | null;
}

/** Rows in EITHER direction around one league (as child AND as parent),
 *  decorated with the other league. Viewer-independent; `missing` =
 *  pre-167 database. */
export async function listParentAffiliations(
  admin: Admin,
  leagueId: string
): Promise<{ rows: ParentAffiliationRow[]; missing: boolean } | null> {
  const { data: rows, error } = await admin
    .from('affiliations')
    .select(PARENT_EDGE_SELECT_WITH_CHILD_KIND)
    .or(`org_id.eq.${leagueId},parent_org_id.eq.${leagueId}`)  // hardening-ok: route-validated UUID
    .eq('child.kind', 'league')
    .limit(200);
  if (error) {
    if (isMissingTableError(error.code)) return { rows: [], missing: true };
    console.error('[PARENTS] list error:', error);
    return null;
  }
  const list = ((rows ?? []) as unknown as ParentEdgeRaw[]).map(publicParentEdge);
  const otherIds = [
    ...new Set(list.map(r => (r.league_id === leagueId ? r.parent_league_id : r.league_id))),
  ];
  const { data: others } = otherIds.length
    ? await admin
        .from('organizations')
        .select('id, name, sport_key, city, region, country')
        .in('id', otherIds)
    : { data: [] };
  const byId = new Map(
    ((others ?? []) as ParentAffiliationRow['org'][]).map(o => [o!.id, o])
  );
  return {
    rows: list.map(r => ({
      ...r,
      org: byId.get(r.league_id === leagueId ? r.parent_league_id : r.league_id) ?? null,
    })),
    missing: false,
  };
}

/** GET — active chain public; pendings split for managers (118 shape,
 *  plus `direction` so the UI can label upward vs downward edges). */
export async function parentsGET(request: NextRequest, leagueId: string) {
  if (!UUID_RE.test(leagueId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const { user } = await getServerAuth(request);
  const admin = getSupabaseAdmin();
  const league = await loadLeague(admin, leagueId);
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const listed = await listParentAffiliations(admin, leagueId);
  if (listed === null) {
    return NextResponse.json({ error: 'Failed to load affiliations' }, { status: 500 });
  }
  const withDirection = listed.rows.map(r => ({
    ...r,
    direction: r.league_id === leagueId ? ('up' as const) : ('down' as const),
  }));
  const viewerRole = user ? await getOrgRole(admin, 'league', leagueId, user.id) : null;
  const manager = isOwnerOrManager(viewerRole);
  const mySide = (r: (typeof withDirection)[number]) =>
    r.direction === 'up' ? 'child' : 'parent';
  return NextResponse.json({
    active: withDirection.filter(r => r.status === 'active'),
    outgoing: manager
      ? withDirection.filter(r => r.status === 'pending' && r.initiated_by === mySide(r))
      : [],
    incoming: manager
      ? withDirection.filter(r => r.status === 'pending' && r.initiated_by !== mySide(r))
      : [],
    viewerIsManager: manager,
  });
}

/** POST — initiate toward a parent (or, with direction 'down', invite a
 *  child). The caller manages the [id] league; initiated_by records which
 *  ROLE (child|parent) that league plays on the row. */
export async function parentPOST(
  request: NextRequest,
  leagueId: string,
  otherLeagueId: string,
  affiliationType: AffiliationType,
  direction: 'up' | 'down'
) {
  const user = await requireAuth(request);
  const limited = await enforceRateLimit(request, 'affiliation', { userId: user.id });
  if (limited) return limited;
  if (!UUID_RE.test(leagueId) || !UUID_RE.test(otherLeagueId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (leagueId === otherLeagueId) {
    return NextResponse.json({ error: 'A league cannot affiliate with itself' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();
  const league = await loadLeague(admin, leagueId);
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const role = await getOrgRole(admin, 'league', leagueId, user.id);
  if (!isOwnerOrManager(role)) {
    return NextResponse.json({ error: 'Only owners and managers can affiliate' }, { status: 403 });
  }
  const other = await loadLeague(admin, otherLeagueId);
  if (!other) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  const childId = direction === 'up' ? leagueId : otherLeagueId;
  const parentId = direction === 'up' ? otherLeagueId : leagueId;
  const { error } = await admin.from('affiliations').insert({
    org_id: childId,
    parent_org_id: parentId,
    status: 'pending',
    initiated_by: direction === 'up' ? 'child' : 'parent',
    requested_by_profile_id: user.id,
    affiliation_type: affiliationType,
  });
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Already affiliated or pending' }, { status: 409 });
    }
    if (isMissingTableError(error.code)) {
      return NextResponse.json(
        { error: 'League affiliations aren’t set up yet — run migration 167' },
        { status: 503 }
      );
    }
    console.error('[PARENTS] insert error:', error);
    return NextResponse.json({ error: 'Failed to send the invite' }, { status: 500 });
  }

  const { notifyAffiliationInvite } = await import('./notify');
  await notifyAffiliationInvite(admin, {
    recipientProfileId: other.owner_profile_id,
    // Both slots carry league names; the initiator rides the first slot.
    leagueName: league.name,
    clubName: other.name,
    initiatedBy: 'league',
    affiliationType,
    actionUrl: `/league/${otherLeagueId}`,
  });
  return NextResponse.json({ ok: true, status: 'pending' });
}

/** PATCH accept — caller must manage the side OPPOSITE initiated_by. */
export async function parentAccept(
  request: NextRequest,
  leagueId: string,
  otherLeagueId: string
) {
  const user = await requireAuth(request);
  if (!UUID_RE.test(leagueId) || !UUID_RE.test(otherLeagueId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const admin = getSupabaseAdmin();
  const league = await loadLeague(admin, leagueId);
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const role = await getOrgRole(admin, 'league', leagueId, user.id);
  if (!isOwnerOrManager(role)) {
    return NextResponse.json({ error: 'Only owners and managers can accept' }, { status: 403 });
  }

  const { data: raw, error } = await admin
    .from('affiliations')
    .select(PARENT_EDGE_SELECT)
    .or(eitherDirection(leagueId, otherLeagueId))  // hardening-ok: route-validated UUIDs
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error.code)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('[PARENTS] row fetch error:', error);
    return NextResponse.json({ error: 'Failed to load the affiliation' }, { status: 500 });
  }
  if (!raw) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const row = publicParentEdge(raw as unknown as ParentEdgeRaw);
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'Already active' }, { status: 409 });
  }
  const myRole = row.league_id === leagueId ? 'child' : 'parent';
  if (row.initiated_by === myRole) {
    return NextResponse.json(
      { error: 'Your side sent this invite — the other side accepts it' },
      { status: 403 }
    );
  }

  const { data: claimed, error: claimError } = await admin
    .from('affiliations')
    .update({
      status: 'active',
      decided_by_profile_id: user.id,
      decided_at: new Date().toISOString(),
    })
    .eq('org_id', row.league_id)
    .eq('parent_org_id', row.parent_league_id)
    .eq('status', 'pending')
    .select();
  if (claimError || !claimed || claimed.length === 0) {
    if (claimError) console.error('[PARENTS] claim error:', claimError);
    return NextResponse.json({ error: 'This invite is no longer pending' }, { status: 409 });
  }

  if (row.affiliation_type === 'sanctioned_by') {
    await recordSanctionGrant(admin, row.parent_league_id, 'league', row.league_id);
  }
  // Both public sites show the chain — purge on change (best-effort).
  const { revalidateOrgSiteForOrg } = await import('@/lib/org-sites/revalidate');
  await revalidateOrgSiteForOrg(admin, 'league', row.league_id);
  await revalidateOrgSiteForOrg(admin, 'league', row.parent_league_id);

  const other = await loadLeague(admin, otherLeagueId);
  if (other) {
    const { notifyAffiliationUpdate } = await import('./notify');
    await notifyAffiliationUpdate(admin, {
      recipientProfileId: row.requested_by_profile_id,
      leagueName: league.name,
      clubName: other.name,
      outcome: 'accepted',
      affiliationType: (row.affiliation_type as AffiliationType | null) ?? 'member_of',
      actionUrl: `/league/${otherLeagueId}`,
    });
  }
  return NextResponse.json({ ok: true, status: 'active' });
}

/** DELETE — withdraw / decline / dissolve per the 118 matrix. */
export async function parentDELETE(
  request: NextRequest,
  leagueId: string,
  otherLeagueId: string
) {
  const user = await requireAuth(request);
  if (!UUID_RE.test(leagueId) || !UUID_RE.test(otherLeagueId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const admin = getSupabaseAdmin();
  const league = await loadLeague(admin, leagueId);
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const role = await getOrgRole(admin, 'league', leagueId, user.id);
  if (!isOwnerOrManager(role)) {
    return NextResponse.json({ error: 'Only owners and managers can do that' }, { status: 403 });
  }

  const { data: raw, error } = await admin
    .from('affiliations')
    .select(PARENT_EDGE_SELECT)
    .or(eitherDirection(leagueId, otherLeagueId))  // hardening-ok: route-validated UUIDs
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error.code)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('[PARENTS] row fetch error:', error);
    return NextResponse.json({ error: 'Failed to load the affiliation' }, { status: 500 });
  }
  if (!raw) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const row = publicParentEdge(raw as unknown as ParentEdgeRaw);

  const { error: deleteError } = await admin
    .from('affiliations')
    .delete()
    .eq('org_id', row.league_id)
    .eq('parent_org_id', row.parent_league_id);
  if (deleteError) {
    console.error('[PARENTS] delete error:', deleteError);
    return NextResponse.json({ error: 'Failed to remove the affiliation' }, { status: 500 });
  }

  const myRole = row.league_id === leagueId ? 'child' : 'parent';
  const other = await loadLeague(admin, otherLeagueId);
  const { notifyAffiliationUpdate } = await import('./notify');

  if (row.status === 'pending' && row.initiated_by === myRole) {
    return NextResponse.json({ action: 'withdrawn' });
  }
  if (row.status === 'pending') {
    if (other) {
      await notifyAffiliationUpdate(admin, {
        recipientProfileId: row.requested_by_profile_id,
        leagueName: league.name,
        clubName: other.name,
        outcome: 'declined',
        affiliationType: (row.affiliation_type as AffiliationType | null) ?? 'member_of',
        actionUrl: `/league/${otherLeagueId}`,
      });
    }
    return NextResponse.json({ action: 'declined' });
  }
  // Active — dissolve; close the grant history for sanctioned_by edges.
  if (row.affiliation_type === 'sanctioned_by') {
    await revokeSanctionGrant(admin, row.parent_league_id, 'league', row.league_id);
  }
  {
    const { revalidateOrgSiteForOrg } = await import('@/lib/org-sites/revalidate');
    await revalidateOrgSiteForOrg(admin, 'league', row.league_id);
    await revalidateOrgSiteForOrg(admin, 'league', row.parent_league_id);
  }
  if (other) {
    await notifyAffiliationUpdate(admin, {
      recipientProfileId: other.owner_profile_id,
      leagueName: league.name,
      clubName: other.name,
      outcome: 'dissolved',
      affiliationType: (row.affiliation_type as AffiliationType | null) ?? 'member_of',
      actionUrl: `/league/${otherLeagueId}`,
    });
  }
  return NextResponse.json({ action: 'dissolved' });
}
