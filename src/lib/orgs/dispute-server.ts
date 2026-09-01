// ── Result disputes (phase 6 R4, mig 168) ───────────────────────────────────
// The workflow the 152 column has been waiting for. Masterplan §7: "when
// a club and a league disagree about a result, the record holds both and
// shows unconfirmed until the competition admin resolves it — do not let
// last-write-wins decide a season."
//
// The matrix:
//   raise / withdraw — a manager of EITHER participating org (an entry
//     team's club or league) or of the owning org.
//   resolve — the OWNING org's manager only.
// Transitions: none→disputed (raise) → none (withdraw, fields cleared)
//                            → resolved (resolve).
// Dispute state never touches provenance (orthogonal by design), and a
// disputed row does not suppress the sanctioned display chip (v1 call).
// Dispute fields live on contest_results but MEAN the contest: every
// result row of the contest carries the same state.
//
// Pre-168 the UPDATE hits missing columns (42703) → a friendly
// "migration pending" answer; bells are best-effort (23514 on the old
// CHECK drops the bell, never the transition — the 163 language).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import type { OrgSide } from './authz';
import { getOrgRole, isOwnerOrManager } from './authz';
import { revalidateOrgSiteForCompetition } from '@/lib/org-sites/revalidate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[DISPUTE]';

export type DisputeAction = 'raise' | 'withdraw' | 'resolve';

interface DisputeInput {
  contestId: string;
  action: DisputeAction;
  note?: string;
}

/** The orgs with standing on a contest: the owner plus every entry
 *  team's club/league. */
async function contestOrgs(
  admin: Admin,
  contestId: string
): Promise<{
  competitionId: string;
  owner: { side: OrgSide; orgId: string };
  participants: { side: OrgSide; orgId: string }[];
} | null> {
  const { data: contest } = await admin
    .from('contests')
    .select('id, competition_id')
    .eq('id', contestId)
    .maybeSingle();
  if (!contest) return null;
  const { data: comp } = await admin
    .from('competitions')
    .select('id, league_id, club_id')
    .eq('id', contest.competition_id)
    .maybeSingle();
  if (!comp) return null;
  const owner: { side: OrgSide; orgId: string } = comp.league_id
    ? { side: 'league', orgId: comp.league_id as string }
    : { side: 'club', orgId: comp.club_id as string };

  const { data: parts } = await admin
    .from('contest_participants')
    .select('entry_id')
    .eq('contest_id', contestId)
    .limit(50);
  const entryIds = [...new Set((parts ?? []).map(p => p.entry_id as string))];
  const { data: entries } = entryIds.length
    ? await admin.from('competition_entries').select('id, team_id').in('id', entryIds)
    : { data: [] };
  const teamIds = [...new Set((entries ?? []).map(e => e.team_id).filter(Boolean))] as string[];
  const { data: teams } = teamIds.length
    ? await admin.from('teams').select('id, club_id, league_id').in('id', teamIds)
    : { data: [] };
  const participants: { side: OrgSide; orgId: string }[] = [];
  for (const t of teams ?? []) {
    if (t.club_id) participants.push({ side: 'club', orgId: t.club_id as string });
    if (t.league_id) participants.push({ side: 'league', orgId: t.league_id as string });
  }
  return { competitionId: comp.id as string, owner, participants };
}

export async function disputePATCH(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string,
  competitionId: string,
  input: DisputeInput
): Promise<NextResponse> {
  if (!input.contestId || !['raise', 'withdraw', 'resolve'].includes(input.action)) {
    return NextResponse.json({ error: 'Invalid dispute action' }, { status: 400 });
  }
  const note = (input.note ?? '').trim().slice(0, 500);

  // The caller manages the org whose console they drive…
  const role = await getOrgRole(admin, side, orgId, user.id);
  if (!isOwnerOrManager(role)) {
    return NextResponse.json({ error: 'Only owners and managers can do that' }, { status: 403 });
  }
  // …and that org must have standing on this contest.
  const orgs = await contestOrgs(admin, input.contestId);
  if (!orgs || orgs.competitionId !== competitionId) {
    return NextResponse.json({ error: 'Contest not found' }, { status: 404 });
  }
  const isOwnerOrg = orgs.owner.side === side && orgs.owner.orgId === orgId;
  const isParticipant = orgs.participants.some(p => p.side === side && p.orgId === orgId);
  if (!isOwnerOrg && !isParticipant) {
    return NextResponse.json(
      { error: 'Your organization has no standing on this game' },
      { status: 403 }
    );
  }
  if (input.action === 'resolve' && !isOwnerOrg) {
    return NextResponse.json(
      { error: 'Only the competition owner resolves disputes' },
      { status: 403 }
    );
  }

  const { data: rows, error: rowsError } = await admin
    .from('contest_results')
    .select('participant_id, dispute_status')
    .eq('contest_id', input.contestId)
    .limit(50);
  if (rowsError) {
    console.error(`${TAG} results read error:`, rowsError);
    return NextResponse.json({ error: 'Failed to load the result' }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'No result to dispute yet' }, { status: 409 });
  }
  const current = (rows[0].dispute_status as string) ?? 'none';

  let patch: Record<string, unknown>;
  if (input.action === 'raise') {
    if (current === 'disputed') {
      return NextResponse.json({ error: 'Already disputed' }, { status: 409 });
    }
    patch = {
      dispute_status: 'disputed',
      disputed_by: user.id,
      disputed_at: new Date().toISOString(),
      dispute_note: note || null,
      resolved_by: null,
      resolved_at: null,
    };
  } else if (input.action === 'withdraw') {
    if (current !== 'disputed') {
      return NextResponse.json({ error: 'Nothing to withdraw' }, { status: 409 });
    }
    patch = {
      dispute_status: 'none',
      disputed_by: null,
      disputed_at: null,
      dispute_note: null,
    };
  } else {
    if (current !== 'disputed') {
      return NextResponse.json({ error: 'Nothing to resolve' }, { status: 409 });
    }
    patch = {
      dispute_status: 'resolved',
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    };
  }

  const { error: updateError } = await admin
    .from('contest_results')
    .update(patch)
    .eq('contest_id', input.contestId);
  if (updateError) {
    if (updateError.code === '42703') {
      return NextResponse.json(
        { error: 'Disputes aren’t set up yet — ask your admin (migration 168)' },
        { status: 409 }
      );
    }
    console.error(`${TAG} update error:`, updateError);
    return NextResponse.json({ error: 'Failed to update the dispute' }, { status: 500 });
  }

  // Bells to every org with standing minus the actor — best-effort.
  const { notifyDispute } = await import('@/lib/competitions/notify');
  const uniqueOrgs = [orgs.owner, ...orgs.participants].filter(
    (o, i, arr) => arr.findIndex(x => x.side === o.side && x.orgId === o.orgId) === i
  );
  await notifyDispute(admin, {
    orgs: uniqueOrgs,
    actorId: user.id,
    competitionId,
    kind: input.action === 'resolve' ? 'resolved' : input.action === 'raise' ? 'raised' : null,
    note: note || null,
    side,
    orgId,
  });

  await revalidateOrgSiteForCompetition(admin, competitionId);
  return NextResponse.json({ ok: true, disputeStatus: patch.dispute_status });
}
