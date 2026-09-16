/**
 * Live Now for events (Events program, phase 4, PR 2) — pure. The cards the
 * strip shows beside the golf rounds: every LIVE event a viewer may open —
 * a public one for anyone (signed out included), plus the ones the viewer
 * plays in or follows — with its live round, the field's size and one
 * door (the board, or the matches on match play). Nothing private leaves:
 * the event's name, sport, format, the round's place and count.
 */
import { isMatchFormat, isStatShape } from './types';

export interface LiveEventRow {
  id: string;
  name: string;
  sport_key: string;
  format: string;
  visibility: string;
  status: string;
  /** Phase 4 (215): round | game | session; absent pre-215. */
  shape?: string | null;
  rounds: Array<{ id: string; sequence: number; name: string | null; status: string; course_name: string; scheduled_on: string; group_post_id: string | null }>;
  /** Accepted playing rows. */
  playing: number;
  followers: number;
  /** The viewer's own row status, when any (accepted → they may open a private event). */
  viewer_status: string | null;
}

export interface LiveEventCard {
  id: string;
  name: string;
  sport_key: string;
  format: string;
  round: { id: string; sequence: number; name: string | null; course_name: string; group_post_id: string | null; round_count: number };
  playing: number;
  followers: number;
  /** Where the card goes: the live round's board, or the matches. */
  href: string;
}

/** The live round (there is at most one) — null when none is live. */
export function liveRoundOf(rows: LiveEventRow['rounds']): LiveEventRow['rounds'][number] | null {
  return rows.find(r => r.status === 'live') ?? null;
}

/** The viewer may open it: public, or their own accepted row. */
export function mayOpen(row: Pick<LiveEventRow, 'visibility' | 'viewer_status'>): boolean {
  return row.visibility === 'public' || row.viewer_status === 'accepted';
}

export function liveEventCards(rows: ReadonlyArray<LiveEventRow>): LiveEventCard[] {
  const out: LiveEventCard[] = [];
  for (const row of rows) {
    if (row.status !== 'live' || !mayOpen(row)) continue;
    const round = liveRoundOf(row.rounds);
    if (!round) continue;
    const roundCount = row.rounds.filter(r => r.status !== 'cancelled').length;
    const tab = isMatchFormat(row.format) ? 'matches' : 'leaderboard';
    // Phase 4: a team shape's door is the live stat screen.
    const href = isStatShape(row.shape) ? `/events/${row.id}/live?round=${round.id}` : `/events/${row.id}?tab=${tab}&round=${round.id}`;
    out.push({
      id: row.id,
      name: row.name,
      sport_key: row.sport_key,
      format: row.format,
      round: { id: round.id, sequence: round.sequence, name: round.name, course_name: round.course_name, group_post_id: round.group_post_id, round_count: roundCount },
      playing: row.playing,
      followers: row.followers,
      href,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
