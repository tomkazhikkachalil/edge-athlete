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
import { eventOrg, eventShape, sidesAgree } from './contest-link';
import { ensureContestParticipants, readCountsToward, readMatchLinks, readRoundSides, syncSideMembers } from './contest-link-server';
import type { RoundMatch } from './match-server';
import { readResultLines } from './stat-results-server';
import { scoreOf } from './stats-server';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { validateStatsAgainstSchema } from '@/lib/sports/stat-line-validate';
import { resolveCompetitionProfile } from '@/lib/sports/competition-profiles';
import { contestResultFor, contestRule, contestStatusFor, provenanceForOrg, type ContestResultRow } from './contest-sync';
import { fetchRoundLeaderboard } from './leaderboard-server';
import type { SportEventRoundRow, SportEventRow } from './types';
import { type OrgKindEmbed } from '@/lib/orgs/org-ref';

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
  // Track 2 PR 10: a GAME writes the fixture's two results from the live score and the players' lines; a session counts toward nothing.
  const kind = eventShape(event);
  if (kind === 'game') return syncGameContest(admin, event, round, actorProfileId);
  if (kind === 'session' || kind === 'stableford') return null;
  try {
    const org = eventOrg(event);
    if (!org) return null;
    const links = await readCountsToward(admin, [round.id]);
    const link = links?.get(round.id);
    if (!link) return null;
    const report: ContestSyncReport = { contestId: link.contestId, synced: 0, skipped: [] };

    const { data: comp } = await admin.from('competitions').select('id, name, scoring_rule, org_id, org:organizations(kind)').eq('id', link.competitionId).maybeSingle();
    if (!comp) return report;
    const competition = comp as unknown as { id: string; name: string | null; scoring_rule: string | null; org_id: string | null; org?: OrgKindEmbed };
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

    // The mirrored golf round per player (241: an opted-out player's is mirrored too, hidden from their profile).
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
      const ctx = await loadGolfLeagueBellContext(admin, { competition: { id: competition.id, name: competition.name, org_id: competition.org_id, org: competition.org }, contest: { id: link.contestId, round: round.name ?? `Round ${round.sequence}` } });
      if (ctx) await notifyGolfRoundsCounted(admin, ctx, counted);
    }
    return report;
  } catch (e) {
    console.error(`${TAG} failed (continuing):`, e);
    return null;
  }
}

/** A GAME round completed (track 2 PR 10): the fixture's two results from the LIVE score (home = side 1), the players' `contest_stat_lines`
 *  from their event lines (the org's copy — the performance row stays the event's `post:` origin; a second origin for one game would double
 *  the dataset), the sides' members re-synced ("who played"), then the golf-sync order: status → standings → site → attachments. A
 *  team-score stat that disagrees with the live score is REPORTED, never blocking. Best-effort. */
export async function syncGameContest(admin: Admin, event: SportEventRow, round: SportEventRoundRow, actorProfileId: string): Promise<ContestSyncReport | null> {
  try {
    const org = eventOrg(event);
    if (!org) return null;
    const links = await readCountsToward(admin, [round.id]);
    const link = links?.get(round.id);
    if (!link) return null;
    const report: ContestSyncReport = { contestId: link.contestId, synced: 0, skipped: [] };
    const { data: comp } = await admin.from('competitions').select('id, sport_key').eq('id', link.competitionId).maybeSingle();
    if (!comp) return report;
    const { data: parts } = await admin.from('contest_participants').select('id, side, entry:entry_id (id, team_id, name)').eq('contest_id', link.contestId);
    type Part = { id: string; side: 'home' | 'away' | null; entry: { id: string; team_id: string | null; name: string | null } | Array<{ id: string; team_id: string | null; name: string | null }> | null };
    const sideOf = (side: 'home' | 'away') => {
      const p = ((parts ?? []) as Part[]).find(x => x.side === side);
      const e = p ? (Array.isArray(p.entry) ? p.entry[0] : p.entry) : null;
      return p && e ? { participantId: p.id, entry: e } : null;
    };
    const home = sideOf('home');
    const away = sideOf('away');
    if (!home || !away) { report.skipped.push({ profileId: '', reason: 'the contest has no two sides' }); return report; }

    const provenance = provenanceForOrg(org);
    const score = scoreOf(round);
    if (typeof score.side1_score === 'number' && typeof score.side2_score === 'number') {
      const rows = [
        { contest_id: link.contestId, participant_id: home.participantId, score: score.side1_score, payload: { sportEvent: { eventId: event.id, roundId: round.id }, period: score.period ?? null, side: 1 }, provenance, entered_by: actorProfileId },
        { contest_id: link.contestId, participant_id: away.participantId, score: score.side2_score, payload: { sportEvent: { eventId: event.id, roundId: round.id }, period: score.period ?? null, side: 2 }, provenance, entered_by: actorProfileId },
      ];
      const { error } = await admin.from('contest_results').upsert(rows, { onConflict: 'participant_id' });
      if (error) { console.error(`${TAG} game results upsert failed:`, error); return report; }
      report.synced = 2;
    } else report.skipped.push({ profileId: '', reason: 'no score was kept' });

    // The players' lines → the org's stat lines (one per athlete, 157's UNIQUE), the sides' members = who played.
    const lines = await readResultLines(admin, event, round);
    const schema = getStatSchema(comp.sport_key as string);
    const teamOf = (side: 1 | 2 | null) => (side === 1 ? home.entry : side === 2 ? away.entry : null);
    const statRows = lines
      .filter(l => l.side !== null && Object.values(l.stats).some(v => typeof v === 'number' && Number.isFinite(v)))
      .filter(l => !schema || validateStatsAgainstSchema(l.stats, schema).ok)
      .map(l => ({ contest_id: link.contestId, team_id: teamOf(l.side)?.team_id ?? null, profile_id: l.profile_id, stats: l.stats, provenance, entered_by: l.entered_by ?? actorProfileId }));
    if (statRows.length > 0) {
      const { error } = await admin.from('contest_stat_lines').upsert(statRows, { onConflict: 'contest_id,profile_id' });
      if (error) console.warn(`${TAG} game stat lines upsert failed:`, error.message);
    }
    const sides = await readRoundSides(admin, event.id, round.id);
    if (!home.entry.team_id) await syncSideMembers(admin, home.entry.id, sides[0]);
    if (!away.entry.team_id) await syncSideMembers(admin, away.entry.id, sides[1]);
    const stat = resolveCompetitionProfile(comp.sport_key as string).teamScoreStat;
    if (stat && typeof score.side1_score === 'number' && typeof score.side2_score === 'number') {
      const sum = (side: 1 | 2) => lines.filter(l => l.side === side).reduce((n, l) => n + (typeof l.stats[stat] === 'number' ? (l.stats[stat] as number) : 0), 0);
      if (sum(1) !== score.side1_score || sum(2) !== score.side2_score) report.skipped.push({ profileId: '', reason: `the players' ${stat} (${sum(1)}–${sum(2)}) differ from the score (${score.side1_score}–${score.side2_score})` });
    }

    await syncContestStatus(admin, round.id, 'completed');
    await recomputeStandingsBestEffort(admin, comp.id as string);
    await revalidateOrgSiteForCompetition(admin, comp.id as string);
    await stampContestAttachments(admin, link.contestId);
    return report;
  } catch (e) {
    console.error(`${TAG} game sync failed (continuing):`, e);
    return null;
  }
}

/** A MATCH round completed (track 2 PR 11, 220): every closed match with a linked contest becomes the bracket's result — the winner 1, the
 *  loser 0, `payload.match {result, decidedBy}` + `sportEvent {eventId, roundId, matchId}`, the org's provenance — the sides matched to home /
 *  away by the players (side 1 = home when nothing says otherwise), then the bracket advances by slot and the golf-sync order runs. A pre-220
 *  database falls back to the round link (one match). Best-effort. */
export async function syncMatchContests(admin: Admin, event: SportEventRow, round: SportEventRoundRow, matches: RoundMatch[], actorProfileId: string): Promise<ContestSyncReport | null> {
  try {
    const org = eventOrg(event);
    if (!org || matches.length === 0) return null;
    const byMatch = await readMatchLinks(admin, [round.id]);
    if (byMatch.size === 0 && matches.length === 1) {
      const links = await readCountsToward(admin, [round.id]);
      const l = links?.get(round.id);
      if (l) byMatch.set(matches[0].id, { contestId: l.contestId, competitionId: l.competitionId, competitionName: l.competitionName, matchId: matches[0].id, roundId: round.id });
    }
    if (byMatch.size === 0) return null;
    const report: ContestSyncReport = { contestId: [...byMatch.values()][0].contestId, synced: 0, skipped: [] };
    const provenance = provenanceForOrg(org);
    const competitionIds = new Set<string>();
    for (const m of matches) {
      const link = byMatch.get(m.id);
      if (!link) continue;
      const winnerSide = m.state.winnerSide ?? m.stored.winner_side;
      if (!winnerSide) { report.skipped.push({ profileId: '', reason: `match ${m.group.sequence} undecided` }); continue; }
      const { data: parts } = await admin.from('contest_participants').select('id, side, entry:entry_id (id, profile_id)').eq('contest_id', link.contestId);
      type Part = { id: string; side: 'home' | 'away' | null; entry: { id: string; profile_id: string | null } | Array<{ id: string; profile_id: string | null }> | null };
      const rows = (parts ?? []) as Part[];
      const home = rows.find(p => p.side === 'home');
      const away = rows.find(p => p.side === 'away');
      if (!home || !away) { report.skipped.push({ profileId: '', reason: `match ${m.group.sequence}: the contest has no two sides` }); continue; }
      // Which contest side is match side 1: the entry whose athlete (or whose members) plays on it; else side 1 = home.
      const entryProfile = (p: Part) => { const e = Array.isArray(p.entry) ? p.entry[0] : p.entry; return e?.profile_id ?? null; };
      const memberIds = async (p: Part) => { const e = Array.isArray(p.entry) ? p.entry[0] : p.entry; if (!e) return []; if (e.profile_id) return [e.profile_id]; const { data } = await admin.from('competition_entry_members').select('profile_id').eq('entry_id', e.id); return ((data ?? []) as Array<{ profile_id: string }>).map(r => r.profile_id); };
      const side1Profiles = new Set(m.sides[0].members.map(x => x.profile_id));
      const awayIds = entryProfile(away) ? [entryProfile(away) as string] : await memberIds(away);
      const homeIds = entryProfile(home) ? [entryProfile(home) as string] : await memberIds(home);
      const side1IsAway = awayIds.length > 0 && awayIds.every(id => side1Profiles.has(id));
      // Leftovers PR 7: a draw that disagrees with the bracket's is REPORTED on the result, never a gate.
      const agree = sidesAgree([m.sides[0].members.map(x => x.profile_id), m.sides[1].members.map(x => x.profile_id)], homeIds, awayIds);
      if (!agree) report.skipped.push({ profileId: '', reason: `match ${m.group.sequence}: the sides differ from the bracket's draw` });
      const side1Part = side1IsAway ? away : home;
      const side2Part = side1IsAway ? home : away;
      const result = m.stored.result ?? m.state.result;
      const decidedBy = m.stored.decided_by ?? m.state.decidedBy;
      const payload = (side: 1 | 2) => ({ match: { result, decidedBy, side, won: winnerSide === side, ...(agree ? {} : { draw_mismatch: true }) }, sportEvent: { eventId: event.id, roundId: round.id, matchId: m.id } });
      const { error } = await admin.from('contest_results').upsert([
        { contest_id: link.contestId, participant_id: side1Part.id, score: winnerSide === 1 ? 1 : 0, payload: payload(1), provenance, entered_by: actorProfileId },
        { contest_id: link.contestId, participant_id: side2Part.id, score: winnerSide === 2 ? 1 : 0, payload: payload(2), provenance, entered_by: actorProfileId },
      ], { onConflict: 'participant_id' });
      if (error) { console.error(`${TAG} match results upsert failed:`, error); continue; }
      await admin.from('contests').update({ status: 'completed' }).eq('id', link.contestId);
      report.synced += 1;
      competitionIds.add(link.competitionId);
      await stampContestAttachments(admin, link.contestId);
    }
    for (const competitionId of competitionIds) {
      const { advanceBracket } = await import('@/lib/orgs/competition-server');
      await advanceBracket(admin, competitionId);
      await recomputeStandingsBestEffort(admin, competitionId);
      await revalidateOrgSiteForCompetition(admin, competitionId);
    }
    return report;
  } catch (e) {
    console.error(`${TAG} match sync failed (continuing):`, e);
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
