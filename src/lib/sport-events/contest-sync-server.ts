/**
 * An event round's results into the org's contest — the I/O half (Events
 * program, phase 2b, B1). Called from `applyRoundTransition`'s completion
 * branch (after the mirror — never inside `round-mirror.ts`, whose charter
 * is one edit) and on live / cancel for the status. Best-effort: never
 * throws, never fails the transition; a round with no linked contest is a
 * no-op. The pipeline after the upsert is the golf-sync engine's, in its
 * order: standings → org site → attachments (`payload.roundRef`) → the
 * performance overlay per counted mirrored round → the "counted" bells.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mirrorContestChange } from '@/lib/competitions/calendar-mirror';
import { stampContestAttachments } from '@/lib/competitions/contest-attachments-server';
import { loadGolfLeagueBellContext, notifyGolfRoundsCounted, type CountedMember } from '@/lib/competitions/golf-league-notify';
import { recomputeStandingsBestEffort } from '@/lib/competitions/standings';
import { revalidateOrgSiteForCompetition } from '@/lib/org-sites/revalidate';
import { golfOverlayFromResult, type ContestResultOrigin } from '@/lib/performance/map';
import { syncGolfRoundPerformance } from '@/lib/performance/write-server';
import { eventOrg } from './contest-link';
import { ensureContestParticipants, readCountsToward } from './contest-link-server';
import { contestResultFor, contestRule, contestStatusFor, provenanceForOrg, type ContestResultRow } from './contest-sync';
import { fetchRoundLeaderboard } from './leaderboard-server';
import type { SportEventRoundRow, SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[sport-events contest-sync]';

export interface ContestSyncReport {
  contestId: string;
  synced: number;
  skipped: Array<{ profileId: string; reason: string }>;
}

/** Round completed: write the org's results from the event's leaderboard. */
export async function syncSportEventContest(admin: Admin, event: SportEventRow, round: SportEventRoundRow & { group_post_id: string | null }, actorProfileId: string): Promise<ContestSyncReport | null> {
  try {
    const org = eventOrg(event);
    if (!org) return null;
    const links = await readCountsToward(admin, [round.id]);
    const link = links?.get(round.id);
    if (!link) return null;
    const report: ContestSyncReport = { contestId: link.contestId, synced: 0, skipped: [] };

    const { data: comp } = await admin.from('competitions').select('id, name, scoring_rule, league_id, club_id').eq('id', link.competitionId).maybeSingle();
    if (!comp) return report;
    const competition = comp as { id: string; name: string | null; scoring_rule: string | null; league_id: string | null; club_id: string | null };
    const board = await fetchRoundLeaderboard(admin, event, round);
    const scored = board.rows.filter(r => typeof r.gross === 'number');
    if (scored.length === 0) return report;

    // Everyone on the board is entered (a late joiner too), then the participant row per profile.
    await ensureContestParticipants(admin, competition.id, [link.contestId], scored.map(r => r.profileId));
    const { data: partRows } = await admin.from('contest_participants').select('id, competition_entries!inner(profile_id)').eq('contest_id', link.contestId).limit(500);
    const participantOf = new Map<string, string>();
    for (const p of (partRows ?? []) as Array<{ id: string; competition_entries: { profile_id: string | null } | Array<{ profile_id: string | null }> }>) {
      const e = Array.isArray(p.competition_entries) ? p.competition_entries[0] : p.competition_entries;
      if (e?.profile_id) participantOf.set(e.profile_id, p.id);
    }

    // The mirrored golf round per player (an opted-out player has none — they still count).
    const golfRoundOf = new Map<string, string>();
    if (round.group_post_id) {
      const { data: gr } = await admin.from('golf_rounds').select('id, profile_id').eq('group_post_id', round.group_post_id);
      for (const g of (gr ?? []) as Array<{ id: string; profile_id: string }>) golfRoundOf.set(g.profile_id, g.id);
    }

    const { data: priorRows } = await admin.from('contest_results').select('participant_id, score, payload').eq('contest_id', link.contestId);
    const prior = new Map(((priorRows ?? []) as Array<{ participant_id: string; score: number | null; payload: Record<string, unknown> | null }>).map(r => [r.participant_id, r]));

    const rule = contestRule(competition.scoring_rule);
    const provenance = provenanceForOrg(org);
    const upserts: ContestResultRow[] = [];
    const counted: CountedMember[] = [];
    for (const row of scored) {
      const participantId = participantOf.get(row.profileId);
      if (!participantId) {
        report.skipped.push({ profileId: row.profileId, reason: 'not entered' });
        continue;
      }
      const result = contestResultFor(row, {
        contestId: link.contestId,
        participantId,
        rule,
        provenance,
        enteredBy: actorProfileId,
        holes: round.holes,
        tee: round.tee,
        golfRoundId: golfRoundOf.get(row.profileId) ?? null,
        groupPostId: round.group_post_id,
        eventId: event.id,
        roundId: round.id,
      });
      if (!result) continue;
      upserts.push(result);
      const was = prior.get(participantId);
      if (!was || was.score !== result.score) {
        counted.push({ profileId: row.profileId, gross: result.payload.gross, net: typeof result.payload.net === 'number' ? result.payload.net : null, holes: result.payload.holes, roundId: result.payload.roundRef.roundId, changed: !!was });
      }
    }
    if (upserts.length === 0) return report;

    const { error } = await admin.from('contest_results').upsert(upserts, { onConflict: 'participant_id' });
    if (error) {
      console.error(`${TAG} results upsert failed:`, error);
      return report;
    }
    report.synced = upserts.length;
    await syncContestStatus(admin, round.id, 'completed');
    await recomputeStandingsBestEffort(admin, competition.id);
    await revalidateOrgSiteForCompetition(admin, competition.id);
    await stampContestAttachments(admin, link.contestId);
    for (const u of upserts) {
      const o = golfOverlayFromResult(u as unknown as ContestResultOrigin);
      if (o) await syncGolfRoundPerformance(admin, o.roundId, o.overlay);
    }
    if (counted.length > 0) {
      const ctx = await loadGolfLeagueBellContext(admin, { competition: { id: competition.id, name: competition.name, league_id: competition.league_id, club_id: competition.club_id }, contest: { id: link.contestId, round: round.name ?? `Round ${round.sequence}` } });
      if (ctx) await notifyGolfRoundsCounted(admin, ctx, counted);
    }
    return report;
  } catch (e) {
    console.error(`${TAG} failed (continuing):`, e);
    return null;
  }
}

/** The round's status onto its contest (live → in_progress, cancelled → canceled, completed) and the mirror event. Best-effort. */
export async function syncContestStatus(admin: Admin, roundId: string, roundStatus: 'scheduled' | 'live' | 'completed' | 'cancelled'): Promise<void> {
  try {
    const links = await readCountsToward(admin, [roundId]);
    const link = links?.get(roundId);
    if (!link) return;
    const status = contestStatusFor(roundStatus);
    const { data } = await admin.from('contests').update({ status }).eq('id', link.contestId).select('event_id, status, scheduled_at, play_from, play_to').maybeSingle();
    if (data) await mirrorContestChange(admin, data as { event_id: string | null; status: string; scheduled_at: string | null; play_from?: string | null; play_to?: string | null });
  } catch (e) {
    console.error(`${TAG} status sync failed (continuing):`, e);
  }
}

/** The rounds whose org contest already publishes to the calendar (the overlay skips them; tolerant pre-211). */
export async function publishedContestRounds(admin: Admin, roundIds: string[]): Promise<Set<string>> {
  if (roundIds.length === 0) return new Set();
  const { data, error } = await admin.from('contests').select('sport_event_round_id, event_id').in('sport_event_round_id', roundIds).not('event_id', 'is', null);
  if (error) return new Set();
  return new Set(((data ?? []) as Array<{ sport_event_round_id: string }>).map(r => r.sport_event_round_id));
}
