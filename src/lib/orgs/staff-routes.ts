// ── Staff route handlers, side-parametrised (org staff program, 178) ────────
// The league/club twins under /api/{leagues,clubs}/[id]/staff/** are thin
// wrappers over these (each calls requireAuth itself — the audit's rule). Gates: LIST = enter_console (the hierarchy section
// shows grant-holders to anyone in the console); INVITE / CHANGE / REVOKE =
// change_roles — owners only, the standing "only owners change roles"
// rule (an admin cannot mint peers). Every change writes the audit trail.

import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { emailService } from '@/lib/email-service';
import { appBaseUrl } from '@/lib/org-sites/urls';
import { requireOrgManager } from './structure-server';
import type { OrgSide } from './authz';
import { createStaffInvite, grantFromInput, listStaffInvites, revokeStaffInvite, writeStaffAudit } from './staff-invites';
import { deleteStaffRow, listStaff, readStaffRow, updateStaffSections } from './staff';
import { notifyStaffInvite, notifyStaffRevoked } from './staff-notify';
import { StaffInviteCreateSchema, StaffRowPatchSchema, describeGrant } from './staff-validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;
type Params = Promise<{ id: string }>;
const TAG = '[ORG STAFF]';

function notFound(side: OrgSide): NextResponse {
  return NextResponse.json({ error: side === 'league' ? 'League not found' : 'Club not found' }, { status: 404 });
}

// The auth gate (requireAuth) is called IN each route file — the route-authz
// audit's contract — and the user arrives here; the org-role gate runs here.
async function gate(
  user: User,
  side: OrgSide,
  params: Params,
  intent: 'enter_console' | 'change_roles'
): Promise<{ response: NextResponse } | { user: User; admin: Admin; org: { id: string; name: string } }> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { response: notFound(side) };
  const admin = getSupabaseAdmin();
  const g = await requireOrgManager(admin, user, side, id, { intent });
  if (!g.ok) return { response: g.response };
  return { user, admin, org: g.org };
}

function fail(label: string, error: unknown): NextResponse {
  if (error instanceof Response) return error as NextResponse;
  console.error(`${TAG} ${label} error:`, error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

/** GET /staff — the org's people with authority + open invites. */
export async function staffListGET(request: NextRequest, user: User, side: OrgSide, params: Params): Promise<NextResponse> {
  try {
    const g = await gate(user, side, params, 'enter_console');
    if ('response' in g) return g.response;
    const [staff, invites] = await Promise.all([listStaff(g.admin, side, g.org.id), listStaffInvites(g.admin, side, g.org.id)]);
    return NextResponse.json({ staff, invites });
  } catch (error) {
    return fail('list', error);
  }
}

/** POST /staff — mint an invite. Owners only. The link is ALWAYS in the
 *  response (the guaranteed channel); email + bell are conveniences. */
export async function staffInvitePOST(request: NextRequest, user: User, side: OrgSide, params: Params): Promise<NextResponse> {
  try {
    const g = await gate(user, side, params, 'change_roles');
    if ('response' in g) return g.response;
    const limited = await enforceRateLimit(request, 'staff-invite', { userId: g.user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, StaffInviteCreateSchema);
    if (!parsed.success) return parsed.response;
    const grant = grantFromInput(parsed.data.grant);
    // The scope must belong to THIS org (never a foreign division/team).
    if (grant.scopeType !== 'org' && grant.scopeId) {
      const col = side === 'league' ? 'league_id' : 'club_id';
      const { data } = await g.admin
        .from(grant.scopeType === 'division' ? 'divisions' : 'teams')
        .select('id')
        .eq('id', grant.scopeId)
        .eq(col, g.org.id)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: 'That division or team is not in this organization' }, { status: 400 });
    }
    if (grant.seasonId) {
      const col = side === 'league' ? 'league_id' : 'club_id';
      const { data } = await g.admin.from('seasons').select('id').eq('id', grant.seasonId).eq(col, g.org.id).maybeSingle();
      if (!data) return NextResponse.json({ error: 'That season is not in this organization' }, { status: 400 });
    }
    const created = await createStaffInvite(g.admin, {
      side,
      orgId: g.org.id,
      invitedEmail: parsed.data.email,
      grant,
      createdBy: g.user.id,
    });
    if ('error' in created) {
      if (created.error?.code === '42P01' || created.error?.code === 'PGRST205') {
        return NextResponse.json({ error: 'Staff invites are not available yet' }, { status: 503 });
      }
      return NextResponse.json({ error: 'Could not create the invite' }, { status: 500 });
    }
    const inviteUrlPath = `/org-invite/${created.rawToken}`;
    const inviteUrl = `${appBaseUrl()}${inviteUrlPath}`;
    const summary = describeGrant(grant);
    await writeStaffAudit(g.admin, {
      side, orgId: g.org.id, profileId: null, actorId: g.user.id, action: 'invited',
      role: grant.role, scopeType: grant.scopeType, scopeId: grant.scopeId, seasonId: grant.seasonId, newSections: grant.sections,
    });
    const belled = await notifyStaffInvite(g.admin, { invitedEmail: parsed.data.email, side, orgId: g.org.id, orgName: g.org.name, summary, inviteUrlPath });
    let emailSent = false;
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const { data: me } = await g.admin.from('profiles').select('first_name, last_name, full_name, display_name').eq('id', g.user.id).maybeSingle();
      const inviterName =
        [me?.first_name, me?.last_name].filter(Boolean).join(' ') || (me?.full_name as string | null) || (me?.display_name as string | null) || g.org.name;
      emailSent = await emailService.sendOrgStaffInvite(parsed.data.email, g.org.name, inviterName, summary, inviteUrl);
    }
    return NextResponse.json(
      { ok: true, inviteId: created.inviteId, inviteUrl, expiresAt: created.expiresAt, emailSent, belled, summary },
      { status: 201 }
    );
  } catch (error) {
    return fail('invite', error);
  }
}

/** DELETE /staff/invites/[inviteId] — revoke an open invite. Owners only. */
export async function staffInviteDELETE(request: NextRequest, user: User, side: OrgSide, params: Promise<{ id: string; inviteId: string }>): Promise<NextResponse> {
  try {
    const { inviteId } = await params;
    if (!UUID_RE.test(inviteId)) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    const g = await gate(user, side, params, 'change_roles');
    if ('response' in g) return g.response;
    const ok = await revokeStaffInvite(g.admin, side, g.org.id, inviteId);
    if (!ok) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    await writeStaffAudit(g.admin, { side, orgId: g.org.id, profileId: null, actorId: g.user.id, action: 'invite_revoked' });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail('invite revoke', error);
  }
}

/** PATCH /staff/[rowId] {sections} — change a staff grant's sections. */
export async function staffRowPATCH(request: NextRequest, user: User, side: OrgSide, params: Promise<{ id: string; rowId: string }>): Promise<NextResponse> {
  try {
    const { rowId } = await params;
    if (!UUID_RE.test(rowId)) return NextResponse.json({ error: 'Grant not found' }, { status: 404 });
    const g = await gate(user, side, params, 'change_roles');
    if ('response' in g) return g.response;
    const parsed = await parseBody(request, StaffRowPatchSchema);
    if (!parsed.success) return parsed.response;
    const row = await readStaffRow(g.admin, side, g.org.id, rowId);
    if (!row) return NextResponse.json({ error: 'Grant not found' }, { status: 404 });
    const ok = await updateStaffSections(g.admin, rowId, parsed.data.sections);
    if (!ok) return NextResponse.json({ error: 'Could not update the grant' }, { status: 500 });
    await writeStaffAudit(g.admin, {
      side, orgId: g.org.id, profileId: row.profileId, actorId: g.user.id, action: 'changed',
      role: 'staff', scopeType: row.scopeType, scopeId: row.scopeId, seasonId: row.seasonId,
      oldSections: row.role === 'admin' ? null : row.sections, newSections: parsed.data.sections,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail('grant change', error);
  }
}

/** DELETE /staff/[rowId] — revoke a grant. Owners only. */
export async function staffRowDELETE(request: NextRequest, user: User, side: OrgSide, params: Promise<{ id: string; rowId: string }>): Promise<NextResponse> {
  try {
    const { rowId } = await params;
    if (!UUID_RE.test(rowId)) return NextResponse.json({ error: 'Grant not found' }, { status: 404 });
    const g = await gate(user, side, params, 'change_roles');
    if ('response' in g) return g.response;
    const row = await readStaffRow(g.admin, side, g.org.id, rowId);
    if (!row) return NextResponse.json({ error: 'Grant not found' }, { status: 404 });
    const ok = await deleteStaffRow(g.admin, rowId);
    if (!ok) return NextResponse.json({ error: 'Could not revoke the grant' }, { status: 500 });
    await writeStaffAudit(g.admin, {
      side, orgId: g.org.id, profileId: row.profileId, actorId: g.user.id, action: 'revoked',
      role: row.role, scopeType: row.scopeType, scopeId: row.scopeId, seasonId: row.seasonId, oldSections: row.sections,
    });
    await notifyStaffRevoked(g.admin, { profileId: row.profileId, side, orgId: g.org.id, orgName: g.org.name });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail('grant revoke', error);
  }
}
