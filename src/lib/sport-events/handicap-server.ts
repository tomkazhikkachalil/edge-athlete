/**
 * The frozen index — the I/O half (Events program, PR 4). At accept the
 * player's computed WHS index is read (fetchHandicapComputation, the
 * read-time recompute) and written to the participant row; an organizer
 * override is never overwritten. Best-effort: a failed snapshot leaves
 * `none` (the board shows gross with a reason), never fails the accept.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchHandicapComputation } from '@/lib/golf/handicap-server';
import { mergeSnapshot, snapshotIndex, type IndexSnapshot } from './handicap';
import type { SportEventParticipantRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export async function snapshotAtAccept(admin: Admin, participant: Pick<SportEventParticipantRow, 'id' | 'profile_id' | 'handicap_index' | 'handicap_source'>): Promise<IndexSnapshot> {
  const existing: IndexSnapshot = { handicap_index: participant.handicap_index, handicap_source: participant.handicap_source };
  if (existing.handicap_source === 'organizer') return existing;
  try {
    const result = await fetchHandicapComputation(participant.profile_id, admin);
    const next = mergeSnapshot(existing, snapshotIndex(result));
    const { error } = await admin.from('sport_event_participants').update(next).eq('id', participant.id);
    if (error) {
      console.error('[sport-events] index snapshot write failed:', error);
      return existing;
    }
    return next;
  } catch (e) {
    console.error('[sport-events] index snapshot failed:', e);
    return existing;
  }
}
