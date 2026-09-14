import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { planCardAction, type CardAction } from '@/lib/sport-events/cards';
import type { CardStatus } from '@/lib/sport-events/scoring-authz';

/**
 * The shared body of /cards/[pid]/submit and /finalize (Events program,
 * PR 6). [pid] is the round's group_post_participants row. The row must
 * belong to one of THIS event's minted rounds; the plan is
 * planCardAction (pure). A missing card row is created on finalize (a
 * player who never scored is closed as they stand) and refused on submit.
 * The route file holds the auth gate (getServerAuth) and hands the user in
 * — the route-authz audit reads gates per route file.
 */
export async function runCardAction(request: NextRequest, user: User, params: Promise<{ id: string; pid: string }>, action: CardAction | 'from_body') {
  const { id, pid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(pid)) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  try {
    const limited = await enforceRateLimit(request, 'sport-event-join', { userId: user.id });
    if (limited) return limited;
    const body = await readJson(request);
    const resolvedAction: CardAction = action === 'from_body' ? ((body as { reopen?: unknown } | null)?.reopen === true ? 'reopen' : 'finalize') : action;
    const actor = await resolveActor(user.id, bodyProfileId(body));
    if (!actor.ok) return actor.response;

    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (read.event.status !== 'live' && read.event.status !== 'completed') return NextResponse.json({ error: 'The event is not live.' }, { status: 409 });

    const { data: row } = await admin
      .from('group_post_participants')
      .select('id, profile_id, status, group_post:group_post_id (id, sport_event_round_id)')
      .eq('id', pid)
      .maybeSingle();
    const gp = row ? (Array.isArray(row.group_post) ? row.group_post[0] : row.group_post) as { id: string; sport_event_round_id: string | null } | null : null;
    if (!row || !gp?.sport_event_round_id) return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    const { data: round } = await admin.from('sport_event_rounds').select('id').eq('id', gp.sport_event_round_id).eq('sport_event_id', id).maybeSingle();
    if (!round) return NextResponse.json({ error: 'Card not found' }, { status: 404 });

    const { data: card } = await admin.from('golf_participant_scores').select('id, status, submitted_at, finalized_by').eq('participant_id', pid).maybeSingle();
    const status = ((card?.status as CardStatus | undefined) ?? 'in_progress');
    const plan = planCardAction(resolvedAction, status, { isOwner: row.profile_id === actor.profileId, canManage: read.access.canManage });
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
    if (!card && resolvedAction === 'submit') return NextResponse.json({ error: 'Enter at least one hole before submitting.' }, { status: 409 });

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status: plan.next.status };
    if (plan.next.submitted_at === 'now') update.submitted_at = now;
    else if (plan.next.submitted_at === null) update.submitted_at = null;
    if (plan.next.finalized_by === 'actor') update.finalized_by = actor.profileId;
    else if (plan.next.finalized_by === null) update.finalized_by = null;
    if (plan.next.scores_confirmed) update.scores_confirmed = true;

    let written;
    if (!card) {
      const { data, error } = await admin.from('golf_participant_scores').insert({ participant_id: pid, entered_by: actor.profileId, scores_confirmed: false, ...update }).select('id, status, submitted_at, finalized_by, scores_confirmed').single();
      if (error) {
        console.error('[sport-events/cards] insert failed:', error);
        return NextResponse.json({ error: 'Could not update the card' }, { status: 500 });
      }
      written = data;
    } else if (plan.changed) {
      const { data, error } = await admin.from('golf_participant_scores').update(update).eq('id', card.id).select('id, status, submitted_at, finalized_by, scores_confirmed').single();
      if (error) {
        console.error('[sport-events/cards] update failed:', error);
        return NextResponse.json({ error: 'Could not update the card' }, { status: 500 });
      }
      written = data;
    } else {
      written = card;
    }
    return NextResponse.json({ card: written, changed: plan.changed }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[sport-events/cards] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
