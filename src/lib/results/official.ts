// ── Is this result OFFICIAL? — the one predicate (results-kept round, 241) ──
// Pure, zero server imports. Tom (Sep 26 2026): a result is official when the
// event is hosted by a club or league, counts toward an org competition (a
// linked contest), or the result was recorded by the org — stored provenance
// club_recorded or stronger. An official result is never untagged, edited or
// removed by its player; its opt-out hides it from the profile only, and a
// wrong person is corrected by the Edge Athlete team on a ticket. Pinned in
// __tests__/results-official.test.ts.

/** The stored provenance rungs (orgs/provenance.ts ResultProvenance) that an org wrote or verified. */
export const OFFICIAL_PROVENANCE: ReadonlySet<string> = new Set(['sanctioned', 'league_verified', 'club_recorded']);

export interface OriginFacts {
  /** sport_events.org_id — a club or league hosts it. */
  eventOrgId?: string | null;
  /** sport_events.competition_id — it counts toward an org competition (221). */
  eventCompetitionId?: string | null;
  /** A contest mirrors the round or a match (211 / 220), or the post / round carries contest_id (181). */
  contestLinked?: boolean;
  /** The result's stored provenance (athlete_performances.provenance or a stat line's). */
  provenance?: string | null;
}

export function isOfficialOrigin(f: OriginFacts): boolean {
  if (f.eventOrgId) return true;
  if (f.eventCompetitionId) return true;
  if (f.contestLinked) return true;
  return !!f.provenance && OFFICIAL_PROVENANCE.has(f.provenance);
}

/** What a door answers when a player tries to remove themselves from an official result. */
export const OFFICIAL_RESULT_REFUSAL =
  'This is an official result, so it stays on the record. You can hide it from your profile — and if it isn’t you, report it and our team will fix it.';
