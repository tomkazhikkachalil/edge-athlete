// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/members ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { OrgMemberRoleSchema, isMissingTableError } from '@/lib/orgs/validate';
import { capabilityAllows, getOrgAndCapabilities, getOrgAndRole, roleAllows } from '@/lib/orgs/authz';
import { getMemberRole, insertOwnerRow, joinOrg, leaveOrg, removeMember, setMemberRole } from '@/lib/orgs/members';
import { parseBody } from '@/lib/validation';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { readOrgAccess } from '@/lib/orgs/access';
import { reportRouteError } from '@/lib/observability/report';
import { recordAuthority } from '@/lib/authority/audit-server';

// ── /api/{leagues,clubs}/[id]/members — open join/leave + manager removal ────────────
// The follow-route template: the actor is ALWAYS the session user (never a
// body-supplied id), the route is a toggle, and the target's existence is
// checked before any insert (a bogus id must 404, not FK-500).

/** POST — toggle the session user's membership. Joined → left; not a member
 *  → joined (role 'member'). Owners can't leave their own org. */
export async function membersRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, `${kind}-join`, { userId: user.id });
    if (limited) return limited;

    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const supabase = getSupabaseAdmin();

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, owner_profile_id')
      .eq('id', id)
      .maybeSingle();
    if (orgError) {
      if (isMissingTableError(orgError.code)) {
        return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
      }
      reportRouteError(`[LEAGUE MEMBERS] ${kind} fetch error:`, orgError);
      return NextResponse.json({ error: `Failed to load ${kind}` }, { status: 500 });
    }
    if (!org) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }

    const { role: existingRole, error: checkError } = await getMemberRole(
      supabase,
      { side: kind, orgId: id },
      user.id
    );
    if (checkError) {
      reportRouteError('[LEAGUE MEMBERS] membership check error:', checkError);
      return NextResponse.json({ error: 'Failed to check membership' }, { status: 500 });
    }

    if (existingRole) {
      if (existingRole === 'owner') {
        return NextResponse.json({ error: "Owners can't leave their league" }, { status: 400 });
      }
      const { error: deleteError } = await leaveOrg(supabase, { side: kind, orgId: id }, user.id);
      if (deleteError) {
        reportRouteError('[LEAGUE MEMBERS] leave error:', deleteError);
        return NextResponse.json({ error: `Failed to leave ${kind}` }, { status: 500 });
      }
      return NextResponse.json({ action: 'left' });
    }

    // DEVLOG 0.1 quirk closed (Sep 2026): a column-only owner joining
    // Program 11: an approval league queues the join (never a pending
    // membership). A second POST while queued WITHDRAWS the request (the
    // same toggle shape as join/leave). The column-only owner still joins.
    if (org.owner_profile_id !== user.id) {
      const access = await readOrgAccess(supabase, kind, id);
      if (access.joinPolicy === 'approval') {
        const { cancelJoinRequest, requestJoin } = await import('@/lib/orgs/join-requests-server');
        if (await cancelJoinRequest(supabase, kind, id, user.id)) {
          return NextResponse.json({ action: 'request_cancelled' });
        }
        const asked = await requestJoin(supabase, kind, { id: org.id, name: org.name }, user.id);
        if ('error' in asked) return NextResponse.json({ error: asked.error }, { status: asked.status });
        return NextResponse.json({ action: 'requested', requestId: asked.requestId });
      }
    }

    // their own league gets an OWNER row, not a member row — the column
    // and the membership table must never disagree about who owns.
    // Onboarding v2 R3: "Count my rounds in league leagues" rides the join.
    const joinBody = (await request.json().catch(() => ({}))) as { rosterConsent?: unknown };
    const rosterConsent = joinBody.rosterConsent === true;
    const { error: insertError } =
      org.owner_profile_id === user.id
        ? await insertOwnerRow(supabase, { side: kind, orgId: id }, user.id)
        : await joinOrg(supabase, { side: kind, orgId: id }, user.id);
    if (insertError) {
      reportRouteError('[LEAGUE MEMBERS] join error:', insertError);
      return NextResponse.json({ error: `Failed to join ${kind}` }, { status: 500 });
    }

    // Best-effort owner notification — never fails the join.
    const { notifyOrgJoin } = await import('@/lib/orgs/notify');
    await notifyOrgJoin(supabase, {
      ownerProfileId: org.owner_profile_id,
      actorId: user.id,
      kind,
      orgId: org.id,
      orgName: org.name,
    });

    let roster: string | null = null;
    if (rosterConsent && org.owner_profile_id !== user.id) {
      const { rosterSelfPost } = await import('@/lib/orgs/roster-server');
      const res = await rosterSelfPost(supabase, user, kind, id);
      const out = (await res.json().catch(() => ({}))) as { action?: string };
      roster = res.ok ? (out.action ?? null) : null;
    }
    return NextResponse.json({ action: 'joined', ...(roster ? { roster } : {}) });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[LEAGUE MEMBERS] POST error:', error);
    return NextResponse.json({ error: 'Failed to process membership' }, { status: 500 });
  }
}

/** PATCH ?profileId= {role} — the OWNER promotes a member to manager or
 *  demotes a manager back. Owner-only on purpose: managers must not mint or
 *  remove peers (the org-managed model). Owner rows stay untouchable HERE —
 *  owner-set changes live in /owners (0.8): transfer = promote + step down. */
export async function membersRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (!profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const loaded = await getOrgAndRole(supabase, kind, id, user.id);
    if (loaded.status === 'error') {
      reportRouteError(`[LEAGUE MEMBERS] ${kind} fetch error:`, loaded.error);
      return NextResponse.json({ error: `Failed to load ${kind}` }, { status: 500 });
    }
    if (loaded.status === 'not_found') {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const org = loaded.org;
    if (!roleAllows(loaded.role, 'change_roles')) {
      return NextResponse.json({ error: 'Only the owner can change roles' }, { status: 403 });
    }

    const parsed = await parseBody(request, OrgMemberRoleSchema);
    if (!parsed.success) return parsed.response;
    const { role } = parsed.data;

    const { role: targetRole } = await getMemberRole(supabase, { side: kind, orgId: id }, profileId);
    if (!targetRole) {
      return NextResponse.json({ error: 'Not a member' }, { status: 404 });
    }
    if (targetRole === 'owner') {
      return NextResponse.json({ error: "The owner's role can't be changed" }, { status: 400 });
    }
    if (targetRole === role) {
      return NextResponse.json({ action: 'unchanged', role });
    }

    const { error: updateError } = await setMemberRole(supabase, { side: kind, orgId: id }, profileId, role);
    if (updateError) {
      reportRouteError('[LEAGUE MEMBERS] role update error:', updateError);
      return NextResponse.json({ error: 'Failed to change role' }, { status: 500 });
    }

    await recordAuthority(supabase, {
      subject: { type: 'org', id },
      actor: { kind: 'member', profileId: user.id },
      action: role === 'manager' ? 'manager_added' : 'manager_removed',
      targetProfileId: profileId,
      detail: { from_role: targetRole, to_role: role },
    });

    // Best-effort — never fails the role change.
    const { notifyOrgRole } = await import('@/lib/orgs/notify');
    await notifyOrgRole(supabase, {
      profileId,
      kind,
      orgId: org.id,
      orgName: org.name,
      role,
    });

    return NextResponse.json({ action: 'role_changed', role });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[LEAGUE MEMBERS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?profileId= — owner/manager removes a member. Only plain 'member'
 *  rows are removable in v1 (owner/manager rows are not). */
export async function membersRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (!profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const loaded = await getOrgAndCapabilities(supabase, kind, id, user.id);
    if (loaded.status === 'error') {
      reportRouteError(`[LEAGUE MEMBERS] ${kind} fetch error:`, loaded.error);
      return NextResponse.json({ error: `Failed to load ${kind}` }, { status: 500 });
    }
    if (loaded.status === 'not_found') {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    if (!capabilityAllows(loaded.caps, 'manage_members')) {
      return NextResponse.json({ error: 'Not authorized to manage members' }, { status: 403 });
    }

    const { role: targetRole } = await getMemberRole(supabase, { side: kind, orgId: id }, profileId);
    if (!targetRole) {
      return NextResponse.json({ error: 'Not a member' }, { status: 404 });
    }
    if (targetRole !== 'member') {
      return NextResponse.json({ error: 'Only member rows can be removed' }, { status: 400 });
    }

    const { error: deleteError } = await removeMember(supabase, { side: kind, orgId: id }, profileId);
    if (deleteError) {
      reportRouteError('[LEAGUE MEMBERS] remove error:', deleteError);
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
    }

    return NextResponse.json({ action: 'removed' });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[LEAGUE MEMBERS] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
