// ── Where did this result come from? (results-kept round, 241) ─────────────
// The server half of the official rule: given a post, a golf round, a group
// post, a stat line or an event, walk every link the schema has to the event
// or contest it belongs to, and answer `official` through the one predicate
// (official.ts). FAILS CLOSED: a read error counts as official — a door that
// cannot tell never lets a player remove an org's result.
//
// The links (the audit's table):
//   posts.sport_event_round_id           → the round → the event   (203)
//   posts.stats_data.sport_event_stat_line_id / sport_event_id      (215)
//   posts.group_post_id → group_posts.sport_event_round_id | contest_id
//   posts.round_id → golf_rounds.group_post_id → the group post
//   posts.contest_id / group_posts.contest_id                        (181)
//   golf_rounds.group_post_id                                       (039)
//   the event: org_id, competition_id, a contest on a round or match (211, 220, 221)
//   the dataset row's stored provenance (club_recorded and up)

import type { SupabaseClient } from '@supabase/supabase-js';
import { isOfficialOrigin } from './official';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic helper (the authz.ts Admin alias)
type Admin = SupabaseClient<any, 'public', any>;

export type ResultRef =
  | { kind: 'post'; id: string }
  | { kind: 'golf_round'; id: string }
  | { kind: 'group_post'; id: string }
  | { kind: 'stat_line'; id: string }
  | { kind: 'event'; id: string };

export interface ResultOrigin {
  official: boolean;
  eventId: string | null;
  orgId: string | null;
  contestLinked: boolean;
  provenance: string | null;
  /** True when a read failed and the answer is the fail-closed default. */
  unknown: boolean;
}

const FAIL_CLOSED: ResultOrigin = { official: true, eventId: null, orgId: null, contestLinked: false, provenance: null, unknown: true };

class ReadFailed extends Error {}

async function one<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw new ReadFailed(error.message);
  return (data as T | null) ?? null;
}

interface EventFacts { id: string; org_id: string | null; competition_id: string | null }

async function eventFacts(admin: Admin, eventId: string): Promise<{ event: EventFacts | null; contestLinked: boolean }> {
  const event = await one<EventFacts>(admin.from('sport_events').select('id, org_id, competition_id').eq('id', eventId).maybeSingle());
  if (!event) return { event: null, contestLinked: false };
  const { data: rounds, error } = await admin.from('sport_event_rounds').select('id').eq('sport_event_id', eventId);
  if (error) throw new ReadFailed(error.message);
  const roundIds = ((rounds ?? []) as { id: string }[]).map(r => r.id);
  if (roundIds.length === 0) return { event, contestLinked: false };
  const { count: byRound, error: e1 } = await admin.from('contests').select('id', { count: 'exact', head: true }).in('sport_event_round_id', roundIds);
  if (e1) throw new ReadFailed(e1.message);
  if ((byRound ?? 0) > 0) return { event, contestLinked: true };
  const { data: matches, error: e2 } = await admin.from('sport_event_matches').select('id').in('sport_event_round_id', roundIds);
  if (e2) throw new ReadFailed(e2.message);
  const matchIds = ((matches ?? []) as { id: string }[]).map(m => m.id);
  if (matchIds.length === 0) return { event, contestLinked: false };
  const { count: byMatch, error: e3 } = await admin.from('contests').select('id', { count: 'exact', head: true }).in('sport_event_match_id', matchIds);
  if (e3) throw new ReadFailed(e3.message);
  return { event, contestLinked: (byMatch ?? 0) > 0 };
}

async function eventIdForRound(admin: Admin, roundId: string): Promise<string | null> {
  const r = await one<{ sport_event_id: string }>(admin.from('sport_event_rounds').select('sport_event_id').eq('id', roundId).maybeSingle());
  return r?.sport_event_id ?? null;
}

async function provenanceFor(admin: Admin, naturalKey: string): Promise<string | null> {
  const r = await one<{ provenance: string | null }>(admin.from('athlete_performances').select('provenance').eq('natural_key', naturalKey).maybeSingle());
  return r?.provenance ?? null;
}

/** The group post's own links: an event round, a contest. */
async function fromGroupPost(admin: Admin, groupPostId: string): Promise<{ eventId: string | null; contestLinked: boolean }> {
  const gp = await one<{ sport_event_round_id: string | null; contest_id: string | null }>(
    admin.from('group_posts').select('sport_event_round_id, contest_id').eq('id', groupPostId).maybeSingle()
  );
  if (!gp) return { eventId: null, contestLinked: false };
  return { eventId: gp.sport_event_round_id ? await eventIdForRound(admin, gp.sport_event_round_id) : null, contestLinked: !!gp.contest_id };
}

async function finish(admin: Admin, eventId: string | null, contestLinked: boolean, provenance: string | null): Promise<ResultOrigin> {
  let orgId: string | null = null;
  let competitionId: string | null = null;
  let linked = contestLinked;
  if (eventId) {
    const facts = await eventFacts(admin, eventId);
    orgId = facts.event?.org_id ?? null;
    competitionId = facts.event?.competition_id ?? null;
    linked = linked || facts.contestLinked;
  }
  return {
    official: isOfficialOrigin({ eventOrgId: orgId, eventCompetitionId: competitionId, contestLinked: linked, provenance }),
    eventId,
    orgId,
    contestLinked: linked,
    provenance,
    unknown: false,
  };
}

export async function resolveResultOrigin(admin: Admin, ref: ResultRef): Promise<ResultOrigin> {
  try {
    switch (ref.kind) {
      case 'event':
        return await finish(admin, ref.id, false, null);
      case 'stat_line': {
        const line = await one<{ sport_event_round_id: string }>(admin.from('sport_event_stat_lines').select('sport_event_round_id').eq('id', ref.id).maybeSingle());
        if (!line) return { ...FAIL_CLOSED, official: false, unknown: false };
        return await finish(admin, await eventIdForRound(admin, line.sport_event_round_id), false, null);
      }
      case 'group_post': {
        const g = await fromGroupPost(admin, ref.id);
        return await finish(admin, g.eventId, g.contestLinked, null);
      }
      case 'golf_round': {
        const r = await one<{ group_post_id: string | null }>(admin.from('golf_rounds').select('group_post_id').eq('id', ref.id).maybeSingle());
        if (!r) return { ...FAIL_CLOSED, official: false, unknown: false };
        const g = r.group_post_id ? await fromGroupPost(admin, r.group_post_id) : { eventId: null, contestLinked: false };
        return await finish(admin, g.eventId, g.contestLinked, await provenanceFor(admin, `golf_round:${ref.id}`));
      }
      case 'post': {
        const p = await one<{ id: string; group_post_id: string | null; sport_event_round_id: string | null; contest_id: string | null; round_id: string | null; stats_data: Record<string, unknown> | null }>(
          admin.from('posts').select('id, group_post_id, sport_event_round_id, contest_id, round_id, stats_data').eq('id', ref.id).maybeSingle()
        );
        if (!p) return { ...FAIL_CLOSED, official: false, unknown: false };
        let eventId: string | null = null;
        let contestLinked = !!p.contest_id;
        const sd = p.stats_data ?? {};
        if (p.sport_event_round_id) eventId = await eventIdForRound(admin, p.sport_event_round_id);
        if (!eventId && typeof sd.sport_event_stat_line_id === 'string') {
          const line = await one<{ sport_event_round_id: string }>(admin.from('sport_event_stat_lines').select('sport_event_round_id').eq('id', sd.sport_event_stat_line_id).maybeSingle());
          if (line) eventId = await eventIdForRound(admin, line.sport_event_round_id);
        }
        if (!eventId && typeof sd.sport_event_id === 'string') eventId = sd.sport_event_id;
        let groupPostId = p.group_post_id;
        if (!groupPostId && p.round_id) {
          const r = await one<{ group_post_id: string | null }>(admin.from('golf_rounds').select('group_post_id').eq('id', p.round_id).maybeSingle());
          groupPostId = r?.group_post_id ?? null;
        }
        if (groupPostId) {
          const g = await fromGroupPost(admin, groupPostId);
          eventId = eventId ?? g.eventId;
          contestLinked = contestLinked || g.contestLinked;
        }
        return await finish(admin, eventId, contestLinked, await provenanceFor(admin, `post:${p.id}`));
      }
    }
  } catch (e) {
    console.error('[results origin] read failed — treating as official:', e instanceof Error ? e.message : e);
    return FAIL_CLOSED;
  }
}
