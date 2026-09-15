/**
 * The feed's match results — the I/O half (Events program, phase 3, PR 11).
 * Behind the posts route's existing round branch: every label on a
 * COMPLETED match round gets its matches' lines (one `fetchRoundMatches`
 * per such round, computed on read like everything else). Never throws —
 * a failure leaves `match_results` null and the card falls back to the
 * announce shape.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { EVENT_COLUMNS } from './access-server';
import { labelsWantingMatchResults, matchResultsFor, type PostSportEvent } from './feed';
import { fetchRoundMatches } from './match-server';
import { projectMatch } from './match-view';
import { ROUND_COLUMNS } from './rounds-server';
import type { SportEventRoundRow, SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export async function applyMatchResults(admin: Admin, labels: Map<string, PostSportEvent>): Promise<void> {
  const wanting = labelsWantingMatchResults(labels);
  if (wanting.length === 0) return;
  try {
    const roundIds = wanting.map(e => e.round_id);
    const eventIds = [...new Set(wanting.map(e => e.id))];
    const [{ data: roundRows }, { data: eventRows }] = await Promise.all([
      admin.from('sport_event_rounds').select(ROUND_COLUMNS).in('id', roundIds),
      admin.from('sport_events').select(EVENT_COLUMNS).in('id', eventIds),
    ]);
    const events = new Map(((eventRows ?? []) as SportEventRow[]).map(e => [e.id, e]));
    for (const round of (roundRows ?? []) as SportEventRoundRow[]) {
      const label = labels.get(round.id);
      const event = events.get(round.sport_event_id);
      if (!label || !event) continue;
      const matches = await fetchRoundMatches(admin, event, round);
      label.match_results = matchResultsFor(matches.map(projectMatch));
    }
    for (const e of wanting) if (e.match_results === undefined) e.match_results = null;
  } catch (err) {
    console.error('[sport-events feed] match results failed:', err);
    for (const e of wanting) if (e.match_results === undefined) e.match_results = null;
  }
}
