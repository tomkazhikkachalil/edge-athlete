import type { SupabaseClient } from '@supabase/supabase-js';
import type { SportKey } from './SportRegistry';
import { declareSport } from './declare-server';

/** The profile's pinned sport keys, by pin order. Pre-263 (42703 / PGRST204) → []. */
export async function readSportPins(client: SupabaseClient, profileId: string): Promise<string[]> {
  const { data, error } = await client
    .from('sport_settings')
    .select('sport_key, pin_order')
    .eq('profile_id', profileId)
    .eq('pinned', true)
    .order('pin_order', { ascending: true });
  if (error) {
    if (error.code !== '42703' && error.code !== 'PGRST204') console.error('[sports] readSportPins failed:', error.message);
    return [];
  }
  return (data ?? []).map(r => r.sport_key as string);
}

/**
 * The ONE writer of pins (263): declare each pinned key (a played sport may
 * have no row yet), unpin everything, then write 1..n — the partial UNIQUE
 * (profile_id, pin_order) WHERE pinned never meets a swap mid-statement.
 * Logs and continues like the waitlist writer; the read after is the truth.
 */
export async function writeSportPins(client: SupabaseClient, profileId: string, pins: string[]): Promise<void> {
  for (const key of pins) await declareSport(client, profileId, key as SportKey);
  const { error: clearErr } = await client
    .from('sport_settings')
    .update({ pinned: false, pin_order: null })
    .eq('profile_id', profileId)
    .eq('pinned', true);
  if (clearErr) console.error('[sports] writeSportPins clear failed:', clearErr.message);
  for (let i = 0; i < pins.length; i++) {
    const { error } = await client
      .from('sport_settings')
      .update({ pinned: true, pin_order: i + 1 })
      .eq('profile_id', profileId)
      .eq('sport_key', pins[i]);
    if (error) console.error('[sports] writeSportPins write failed:', pins[i], error.message);
  }
}
