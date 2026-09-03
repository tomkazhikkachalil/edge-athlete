// ── Join requests (phase 9 V2, both sides in program 11) — the queue's I/O ──
// An org with join_policy 'approval' queues joins in club_join_requests
// (mig 176) / league_join_requests (mig 177) — NOT a pending membership
// (every membership reader is status-blind by design). Approve = the
// existing joinOrg + delete the request; decline = delete. Every write is
// service-role, gated by the routes (managers decide; the requester owns
// their own request). Side-generic: the table, the org column and the bells
// follow `side`.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from './authz';
import { joinOrg } from './members';
import { joinRequestsTable } from './join-requests';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG JOIN REQUESTS]';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

/** Owners + managers of the org (follow rows). */
export async function orgManagerIds(admin: Admin, side: OrgSide, orgId: string): Promise<string[]> {
  const { data } = await admin
    .from('memberships')
    .select('profile_id')
    .eq(orgColumn(side), orgId)
    .eq('scope_type', 'org')
    .eq('kind', 'follow')
    .in('role', ['owner', 'manager'])
    .limit(200);
  return [...new Set((data ?? []).map(r => r.profile_id as string))];
}

export async function viewerJoinRequest(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  profileId: string | null
): Promise<{ id: string } | null> {
  if (!profileId) return null;
  const { data, error } = await admin
    .from(joinRequestsTable(side))
    .select('id')
    .eq(orgColumn(side), orgId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id as string };
}

async function notifyRequest(admin: Admin, side: OrgSide, org: { id: string; name: string }, actorId: string, requestId: string) {
  const managerIds = await orgManagerIds(admin, side, org.id);
  if (side === 'league') {
    const { notifyLeagueJoinRequest } = await import('@/lib/leagues/notify');
    await notifyLeagueJoinRequest(admin, { managerIds, actorId, leagueId: org.id, leagueName: org.name, requestId });
  } else {
    const { notifyClubJoinRequest } = await import('@/lib/clubs/notify');
    await notifyClubJoinRequest(admin, { managerIds, actorId, clubId: org.id, clubName: org.name, requestId });
  }
}

async function notifyDecision(admin: Admin, side: OrgSide, org: { id: string; name: string }, profileId: string, approved: boolean, requestId: string) {
  if (side === 'league') {
    const { notifyLeagueJoinDecision } = await import('@/lib/leagues/notify');
    await notifyLeagueJoinDecision(admin, { profileId, leagueId: org.id, leagueName: org.name, approved, requestId });
  } else {
    const { notifyClubJoinDecision } = await import('@/lib/clubs/notify');
    await notifyClubJoinDecision(admin, { profileId, clubId: org.id, clubName: org.name, approved, requestId });
  }
}

/** The requester asks (idempotent — a second ask answers the same request). */
export async function requestJoin(
  admin: Admin,
  side: OrgSide,
  org: { id: string; name: string },
  profileId: string
): Promise<{ requestId: string; created: boolean } | { error: string; status: number }> {
  const existing = await viewerJoinRequest(admin, side, org.id, profileId);
  if (existing) return { requestId: existing.id, created: false };
  const { data, error } = await admin
    .from(joinRequestsTable(side))
    .insert({ [orgColumn(side)]: org.id, profile_id: profileId })
    .select('id')
    .single();
  if (error || !data) {
    if (error?.code === '23505') {
      const again = await viewerJoinRequest(admin, side, org.id, profileId);
      if (again) return { requestId: again.id, created: false };
    }
    if (error?.code === '42P01' || error?.code === 'PGRST205') {
      return { error: 'Join requests are not available yet', status: 503 };
    }
    console.error(`${TAG} insert error:`, error);
    return { error: 'Failed to send the request', status: 500 };
  }
  await notifyRequest(admin, side, org, profileId, data.id as string);
  return { requestId: data.id as string, created: true };
}

/** The requester withdraws. */
export async function cancelJoinRequest(admin: Admin, side: OrgSide, orgId: string, profileId: string): Promise<boolean> {
  const { data } = await admin
    .from(joinRequestsTable(side))
    .delete()
    .eq(orgColumn(side), orgId)
    .eq('profile_id', profileId)
    .select('id');
  return (data ?? []).length > 0;
}

export interface JoinRequestRow {
  id: string;
  profileId: string;
  name: string;
  handle: string | null;
  message: string | null;
  createdAt: string;
}

/** The manager's queue (a manager surface — real names). */
export async function listJoinRequests(admin: Admin, side: OrgSide, orgId: string): Promise<NextResponse> {
  const { data, error } = await admin
    .from(joinRequestsTable(side))
    .select('id, profile_id, message, created_at')
    .eq(orgColumn(side), orgId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ requests: [] });
    console.error(`${TAG} list error:`, error);
    return NextResponse.json({ error: 'Failed to load join requests' }, { status: 500 });
  }
  const rows = data ?? [];
  const ids = [...new Set(rows.map(r => r.profile_id as string))];
  const { data: profiles } = ids.length
    ? await admin.from('profiles').select('id, first_name, last_name, full_name, display_name, handle').in('id', ids)
    : { data: [] as Record<string, unknown>[] };
  const byId = new Map((profiles ?? []).map(p => [p.id as string, p as Record<string, unknown>]));
  const requests: JoinRequestRow[] = rows.map(r => {
    const p = byId.get(r.profile_id as string) ?? {};
    const name =
      [p.first_name, p.last_name].filter(Boolean).join(' ') ||
      (p.full_name as string | null) ||
      (p.display_name as string | null) ||
      'Athlete';
    return {
      id: r.id as string,
      profileId: r.profile_id as string,
      name,
      handle: (p.handle as string | null) ?? null,
      message: (r.message as string | null) ?? null,
      createdAt: r.created_at as string,
    };
  });
  return NextResponse.json({ requests });
}

/** A manager decides. The delete is the claim (zero rows ⇒ already decided). */
export async function decideJoinRequest(
  admin: Admin,
  side: OrgSide,
  org: { id: string; name: string },
  requestId: string,
  decision: 'approve' | 'decline'
): Promise<NextResponse> {
  const { data: claimed, error } = await admin
    .from(joinRequestsTable(side))
    .delete()
    .eq('id', requestId)
    .eq(orgColumn(side), org.id)
    .select('id, profile_id');
  if (error) {
    console.error(`${TAG} claim error:`, error);
    return NextResponse.json({ error: 'Failed to decide the request' }, { status: 500 });
  }
  const row = claimed?.[0];
  if (!row) return NextResponse.json({ error: 'Request already decided' }, { status: 409 });
  const profileId = row.profile_id as string;
  if (decision === 'approve') {
    const { error: joinError } = await joinOrg(admin, { side, orgId: org.id }, profileId);
    if (joinError && joinError.code !== '23505') {
      console.error(`${TAG} join error:`, joinError);
      // The request is gone; the member can ask again.
      return NextResponse.json({ error: 'Failed to add the member' }, { status: 500 });
    }
  }
  await notifyDecision(admin, side, org, profileId, decision === 'approve', requestId);
  return NextResponse.json({ ok: true, decision, profileId });
}
