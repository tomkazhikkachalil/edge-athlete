// ── Join requests (phase 9 V2) — the approval queue's I/O ───────────────────
// A club with join_policy 'approval' queues joins in club_join_requests
// (mig 176) — NOT a pending membership (every membership reader is
// status-blind by design). Approve = the existing joinOrg + delete the
// request; decline = delete. Every write is service-role, gated by the
// routes (managers decide; the requester owns their own request).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { joinOrg } from '@/lib/orgs/members';
import { notifyClubJoinDecision, notifyClubJoinRequest } from './notify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[CLUB JOIN REQUESTS]';

/** Owners + managers of the club (follow rows). */
export async function clubManagerIds(admin: Admin, clubId: string): Promise<string[]> {
  const { data } = await admin
    .from('memberships')
    .select('profile_id')
    .eq('club_id', clubId)
    .eq('scope_type', 'org')
    .eq('kind', 'follow')
    .in('role', ['owner', 'manager'])
    .limit(200);
  return [...new Set((data ?? []).map(r => r.profile_id as string))];
}

export async function viewerJoinRequest(admin: Admin, clubId: string, profileId: string | null): Promise<{ id: string } | null> {
  if (!profileId) return null;
  const { data, error } = await admin
    .from('club_join_requests')
    .select('id')
    .eq('club_id', clubId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id as string };
}

/** The requester asks (idempotent — a second ask answers the same request). */
export async function requestJoin(
  admin: Admin,
  club: { id: string; name: string },
  profileId: string
): Promise<{ requestId: string; created: boolean } | { error: string; status: number }> {
  const existing = await viewerJoinRequest(admin, club.id, profileId);
  if (existing) return { requestId: existing.id, created: false };
  const { data, error } = await admin
    .from('club_join_requests')
    .insert({ club_id: club.id, profile_id: profileId })
    .select('id')
    .single();
  if (error || !data) {
    if (error?.code === '23505') {
      const again = await viewerJoinRequest(admin, club.id, profileId);
      if (again) return { requestId: again.id, created: false };
    }
    if (error?.code === '42P01' || error?.code === 'PGRST205') {
      return { error: 'Join requests are not available yet', status: 503 };
    }
    console.error(`${TAG} insert error:`, error);
    return { error: 'Failed to send the request', status: 500 };
  }
  await notifyClubJoinRequest(admin, {
    managerIds: await clubManagerIds(admin, club.id),
    actorId: profileId,
    clubId: club.id,
    clubName: club.name,
    requestId: data.id as string,
  });
  return { requestId: data.id as string, created: true };
}

/** The requester withdraws. */
export async function cancelJoinRequest(admin: Admin, clubId: string, profileId: string): Promise<boolean> {
  const { data } = await admin
    .from('club_join_requests')
    .delete()
    .eq('club_id', clubId)
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
export async function listJoinRequests(admin: Admin, clubId: string): Promise<NextResponse> {
  const { data, error } = await admin
    .from('club_join_requests')
    .select('id, profile_id, message, created_at')
    .eq('club_id', clubId)
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
  club: { id: string; name: string },
  requestId: string,
  decision: 'approve' | 'decline'
): Promise<NextResponse> {
  const { data: claimed, error } = await admin
    .from('club_join_requests')
    .delete()
    .eq('id', requestId)
    .eq('club_id', club.id)
    .select('id, profile_id');
  if (error) {
    console.error(`${TAG} claim error:`, error);
    return NextResponse.json({ error: 'Failed to decide the request' }, { status: 500 });
  }
  const row = claimed?.[0];
  if (!row) return NextResponse.json({ error: 'Request already decided' }, { status: 409 });
  const profileId = row.profile_id as string;
  if (decision === 'approve') {
    const { error: joinError } = await joinOrg(admin, { side: 'club', orgId: club.id }, profileId);
    if (joinError && joinError.code !== '23505') {
      console.error(`${TAG} join error:`, joinError);
      // The request is gone; the member can ask again.
      return NextResponse.json({ error: 'Failed to add the member' }, { status: 500 });
    }
  }
  await notifyClubJoinDecision(admin, { profileId, clubId: club.id, clubName: club.name, approved: decision === 'approve', requestId });
  return NextResponse.json({ ok: true, decision, profileId });
}
