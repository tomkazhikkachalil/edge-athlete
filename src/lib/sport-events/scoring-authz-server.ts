/**
 * Who may write this card, and how — the I/O half (Events program, PR 6).
 * Reads the participant row, its round, the event context (role and
 * group) and the card, then asks `scoringRight` (pure). The two score
 * routes call this FIRST and pick the client from the verdict: RLS admits
 * the participant and the round's creator (200), so a group-mate or a
 * co-organizer writes on the admin client — the gate IS the authorization.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { startingHoleNumber } from '@/lib/golf/holes';
import { holeRangeFor, scoringRight, type CardStatus, type ScoringRight } from './scoring-authz';
import type { SportEventRole } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface ScoringContext {
  participant: { id: string; profile_id: string; status: string; group_post_id: string };
  groupPost: { id: string; creator_id: string; sport_event_round_id: string | null };
  card: { id: string | null; status: CardStatus };
  event: { id: string; round_id: string; viewer_role: SportEventRole | 'viewer' | null; same_group: boolean; recorder: boolean; self_entry: boolean } | null;
  range: { startingHole: number; holesPlayed: number };
  right: ScoringRight;
}

export type ScoringResolution = { ok: true; ctx: ScoringContext } | { ok: false; status: 404 | 500; error: string };

export async function resolveScoringRight(admin: Admin, viewerId: string, participantRowId: string): Promise<ScoringResolution> {
  const { data: p, error } = await admin
    .from('group_post_participants')
    .select('id, profile_id, status, group_post_id, group_post:group_post_id (id, creator_id, sport_event_round_id, golf_data:golf_scorecard_data (hole_data, holes_played))')
    .eq('id', participantRowId)
    .maybeSingle();
  if (error) {
    console.error('[scoring-authz] participant read failed:', error);
    return { ok: false, status: 500, error: 'Internal server error' };
  }
  if (!p) return { ok: false, status: 404, error: 'Participant not found' };
  const gpRaw = Array.isArray(p.group_post) ? p.group_post[0] : p.group_post;
  if (!gpRaw) return { ok: false, status: 404, error: 'Participant not found' };
  const gp = gpRaw as { id: string; creator_id: string; sport_event_round_id: string | null; golf_data: { hole_data: Array<{ hole: number }> | null; holes_played: number | null } | Array<{ hole_data: Array<{ hole: number }> | null; holes_played: number | null }> | null };
  const golfData = Array.isArray(gp.golf_data) ? gp.golf_data[0] : gp.golf_data;

  const { data: cardRow } = await admin.from('golf_participant_scores').select('id, status').eq('participant_id', p.id).maybeSingle();
  const card = { id: (cardRow?.id as string | undefined) ?? null, status: ((cardRow?.status as CardStatus | undefined) ?? 'in_progress') };

  let event: ScoringContext['event'] = null;
  let eventRound: { starting_hole: number; holes: number } | null = null;
  if (gp.sport_event_round_id) {
    const { data: round } = await admin.from('sport_event_rounds').select('id, sport_event_id, starting_hole, holes').eq('id', gp.sport_event_round_id).maybeSingle();
    if (round) {
      eventRound = { starting_hole: round.starting_hole as number, holes: round.holes as number };
      // Phase 4 (214): the event's self_entry and the viewer's recorder flag ride the same reads.
      const { data: ev } = await admin.from('sport_events').select('id, host_profile_id, self_entry').eq('id', round.sport_event_id).maybeSingle();
      const { data: rows } = await admin.from('sport_event_participants').select('id, profile_id, role, status, recorder').eq('sport_event_id', round.sport_event_id).in('profile_id', [viewerId, p.profile_id]);
      const list = (rows ?? []) as Array<{ id: string; profile_id: string; role: SportEventRole; status: string; recorder?: boolean }>;
      const viewerRow = list.find(r => r.profile_id === viewerId) ?? null;
      const ownerRow = list.find(r => r.profile_id === p.profile_id) ?? null;
      let viewerRole: SportEventRole | 'viewer' | null = viewerRow && viewerRow.status !== 'declined' && viewerRow.status !== 'removed' ? viewerRow.role : 'viewer';
      if (ev && ev.host_profile_id === viewerId) viewerRole = 'organizer';
      let sameGroup = false;
      if (viewerRow && ownerRow && viewerRow.id !== ownerRow.id) {
        const { data: members } = await admin.from('sport_event_group_members').select('group_id, participant_id').eq('sport_event_round_id', round.id).in('participant_id', [viewerRow.id, ownerRow.id]);
        const groups = new Set(((members ?? []) as Array<{ group_id: string }>).map(m => m.group_id));
        sameGroup = (members ?? []).length === 2 && groups.size === 1;
      }
      event = { id: round.sport_event_id as string, round_id: round.id as string, viewer_role: viewerRole, same_group: sameGroup, recorder: !!viewerRow && viewerRow.status === 'accepted' && viewerRow.recorder === true, self_entry: (ev as { self_entry?: boolean } | null)?.self_entry !== false };
    }
  }

  const range = holeRangeFor({ eventRound, derivedStartingHole: startingHoleNumber(golfData?.hole_data ?? null, golfData?.holes_played ?? null), holesPlayed: golfData?.holes_played ?? null });
  const right = scoringRight({ viewerId, ownerProfileId: p.profile_id, roundCreatorId: gp.creator_id, eventRole: event?.viewer_role ?? null, sameGroup: event?.same_group ?? false, card: { status: card.status }, recorder: event?.recorder ?? false, selfEntry: event?.self_entry ?? true });
  return {
    ok: true,
    ctx: {
      participant: { id: p.id as string, profile_id: p.profile_id as string, status: p.status as string, group_post_id: p.group_post_id as string },
      groupPost: { id: gp.id, creator_id: gp.creator_id, sport_event_round_id: gp.sport_event_round_id },
      card,
      event,
      range,
      right,
    },
  };
}

/** A write on a submitted card by its owner reopens it (the partner's entry is theirs to revise). */
export async function reopenIfNeeded(admin: Admin, ctx: ScoringContext): Promise<void> {
  if (!ctx.right.allowed || !ctx.right.reopens || !ctx.card.id) return;
  const { error } = await admin.from('golf_participant_scores').update({ status: 'in_progress', submitted_at: null, finalized_by: null }).eq('id', ctx.card.id);
  if (error) console.error('[scoring-authz] reopen failed:', error);
}
