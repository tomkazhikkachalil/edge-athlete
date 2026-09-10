// ── Contest view (Contest Place E1) — the ONE reader behind /event/[id] ───
// A contest had no page of its own: the console lists rows, the standings
// twins key columns by contest id, the calendar carries a mirror event,
// and every surface re-derived "who won" for itself. This module assembles
// ONE view — contest + competition + org + venue + entrants + results
// (with the display tier) + the derived outcome + stat lines + published,
// consent-gated media + the live round — that the in-app page reads today
// and the org-site twin (E4) and the share card read next.
//
// Rules, each measured elsewhere and reused here on purpose:
//  * ACCESS is decided in exactly one place, resolveContestAccess: a public
//    competition of a public org answers everyone; otherwise the viewer
//    must hold an org role, any staff capability, an athlete entry, or a
//    team-scope roster row on an entered team. The reads are service-role
//    (posture A) — this gate IS the enforcement, like public-standings.
//  * NAMES pass through publicDisplayName / publicHandle in BOTH access
//    modes, the standings twins' rule: a supervised or unclaimed entrant
//    reads "First L." and never links. Emails and supervision state feed
//    the rule inside projectContestView and never leave it.
//  * MEDIA is only what evaluatePublicContestMedia clears (published, on a
//    public active/completed competition, every tagged minor consented) —
//    the gallery gate, so a private competition's media stays in the
//    console. The proxy route self-gates the bytes.
//  * The 'sanctioned' tier is DERIVED at read time (deriveDisplayTier over
//    readSanctionedPairs), never stored.
//  * NEVER THROWS: a missing table (pre-152) or any read error reads as
//    "no such contest" — the page shows its not-available state.
//
// E2 adds posts + the live round from `contest_id` columns (mig 181); until
// then the live round comes from the golf sync's payload.roundRef.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/leagues/validate';
import { readOrgAccess, type OrgAccess } from '@/lib/orgs/access';
import { getOrgCapabilities, hasAnyCapability, type OrgSide } from '@/lib/orgs/authz';
import { deriveDisplayTier, type ResultProvenance } from '@/lib/orgs/provenance';
import { readSanctionedPairs } from '@/lib/orgs/sanction-reads';
import { evaluatePublicContestMedia } from '@/lib/orgs/gallery-gate';
import { publicDisplayName, publicHandle, type MaskableProfile } from '@/lib/orgs/public-names';
import { canViewSharedRound } from '@/lib/golf/round-access';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';
import { deriveContestOutcome, type ContestOutcome } from './contest-outcome';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the authz.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[contest-view]';

export type ContestAccess = 'public' | 'member';

export interface ContestViewEntrant {
  participantId: string;
  entryId: string;
  side: 'home' | 'away' | null;
  startPosition: number | null;
  /** Display-safe (masked where the name rule says so). */
  name: string;
  /** Only for a public, unsupervised, claimed athlete entrant; null otherwise. */
  handle: string | null;
  isTeam: boolean;
  result: {
    score: number | null;
    /** The DISPLAY tier (sanctioned derived). */
    provenance: ResultProvenance;
    disputeStatus: 'none' | 'disputed' | 'resolved';
    payload: Record<string, unknown>;
  } | null;
}

export interface ContestStatLine {
  name: string;
  handle: string | null;
  teamName: string | null;
  stats: Record<string, number>;
  provenance: ResultProvenance;
}

export interface ContestMediaItem {
  id: string;
  url: string;
  mediaType: 'image' | 'video';
  caption: string | null;
  createdAt: string;
}

export interface ContestView {
  contest: {
    id: string;
    status: string;
    round: string | null;
    scheduledAt: string | null;
    /** The mirror event's timezone (the organizer's at publish); 'UTC' when
     *  the contest was never published to the calendar. */
    timezone: string;
    holes: number | null;
    playFrom: string | null;
    playTo: string | null;
    eventId: string | null;
    venueName: string | null;
    facilityName: string | null;
    courseName: string | null;
  };
  competition: {
    id: string;
    name: string;
    format: string;
    entrantType: string;
    sportKey: string;
    sportName: string;
    scoringRule: string | null;
    status: string;
    visibility: string;
    seasonLabel: string | null;
  };
  org: { side: OrgSide; id: string; name: string };
  entrants: ContestViewEntrant[];
  outcome: ContestOutcome;
  /** The sport's stat vocabulary, in schema order (empty for golf). */
  statFields: { key: string; label: string; shortLabel: string }[];
  statLines: ContestStatLine[];
  media: ContestMediaItem[];
  liveRound: { groupPostId: string } | null;
}

export interface ContestViewResult {
  access: ContestAccess;
  view: ContestView;
}

// ── The raw record the reader assembles; projectContestView makes it safe ──

export interface RawProfile extends MaskableProfile {
  id: string;
  handle: string | null;
}

export interface RawEntrant {
  participantId: string;
  entryId: string;
  side: 'home' | 'away' | null;
  startPosition: number | null;
  teamId: string | null;
  teamName: string | null;
  teamClubId: string | null;
  profile: RawProfile | null;
  result: {
    score: number | null;
    provenance: string;
    disputeStatus: string;
    payload: Record<string, unknown> | null;
  } | null;
}

export interface RawStatLine {
  teamId: string | null;
  teamName: string | null;
  teamClubId: string | null;
  profile: RawProfile | null;
  stats: Record<string, number>;
  provenance: string;
}

export interface RawContestRecord {
  contest: ContestView['contest'];
  competition: ContestView['competition'];
  org: ContestView['org'];
  ownerLeagueId: string | null;
  /** `"${ownerLeagueId}:${clubId}"` pairs from readSanctionedPairs. */
  sanctionedPairs: ReadonlySet<string>;
  entrants: RawEntrant[];
  statLines: RawStatLine[];
  media: ContestMediaItem[];
  liveRound: { groupPostId: string } | null;
}

const PROVENANCE: ResultProvenance[] = ['sanctioned', 'league_verified', 'club_recorded', 'self_reported', 'imported'];
const asProvenance = (v: string): ResultProvenance =>
  (PROVENANCE as string[]).includes(v) ? (v as ResultProvenance) : 'club_recorded';
const asDispute = (v: string): 'none' | 'disputed' | 'resolved' =>
  v === 'disputed' || v === 'resolved' ? v : 'none';

/**
 * PURE: the safe view from the raw record. Names masked, handles only for
 * public profiles, ids of people gone, the display tier derived. The same
 * projection serves both access modes — what differs between them is
 * WHICH contests answer (resolveContestAccess), never what a name looks
 * like.
 */
export function projectContestView(raw: RawContestRecord): ContestView {
  const tier = (stored: string, clubId: string | null): ResultProvenance =>
    deriveDisplayTier(asProvenance(stored), {
      ownerIsLeague: raw.ownerLeagueId !== null,
      sanctionedEdgeToClub:
        raw.ownerLeagueId !== null && clubId !== null && raw.sanctionedPairs.has(`${raw.ownerLeagueId}:${clubId}`),
    });
  const nameOf = (e: { teamName: string | null; profile: RawProfile | null }): string =>
    e.profile ? publicDisplayName(e.profile) : (e.teamName ?? 'Entrant');
  const handleOf = (p: RawProfile | null): string | null => (p ? publicHandle(p) : null);

  const entrants: ContestViewEntrant[] = raw.entrants.map(e => ({
    participantId: e.participantId,
    entryId: e.entryId,
    side: e.side,
    startPosition: e.startPosition,
    name: nameOf(e),
    handle: handleOf(e.profile),
    isTeam: e.teamId !== null,
    result: e.result
      ? {
          score: e.result.score,
          provenance: tier(e.result.provenance, e.teamClubId),
          disputeStatus: asDispute(e.result.disputeStatus),
          payload: e.result.payload ?? {},
        }
      : null,
  }));

  const outcome = deriveContestOutcome({
    format: raw.competition.format,
    sportKey: raw.competition.sportKey,
    scoringRule: raw.competition.scoringRule,
    status: raw.contest.status,
    participants: entrants.map(e => ({
      participantId: e.participantId,
      entryId: e.entryId,
      side: e.side,
      startPosition: e.startPosition,
      name: e.name,
      score: e.result?.score ?? null,
      payload: e.result?.payload ?? null,
    })),
  });

  const schema = getStatSchema(raw.competition.sportKey);
  const statFields = (schema?.fields ?? []).map(f => ({ key: f.key, label: f.label, shortLabel: f.shortLabel }));

  return {
    contest: raw.contest,
    competition: raw.competition,
    org: raw.org,
    entrants,
    outcome,
    statFields,
    statLines: raw.statLines.map(l => ({
      name: nameOf(l),
      handle: handleOf(l.profile),
      teamName: l.teamName,
      stats: l.stats,
      provenance: tier(l.provenance, l.teamClubId),
    })),
    media: raw.media,
    liveRound: raw.liveRound,
  };
}

// ── Access ─────────────────────────────────────────────────────────────────

interface AccessInput {
  competition: { id: string; visibility: string; leagueId: string | null; clubId: string | null };
  orgAccess: OrgAccess;
  viewerId: string | null;
  /** Team ids of the entered teams (for the roster check). */
  teamIds: string[];
}

/** THE gate. Public competition + public org → everyone; else a member. */
export async function resolveContestAccess(admin: Admin, input: AccessInput): Promise<ContestAccess | null> {
  if (input.competition.visibility === 'public' && input.orgAccess.visibility === 'public') return 'public';
  const viewer = input.viewerId;
  if (!viewer) return null;
  const side: OrgSide = input.competition.leagueId ? 'league' : 'club';
  const orgId = input.competition.leagueId ?? input.competition.clubId;
  if (!orgId) return null;
  try {
    const caps = await getOrgCapabilities(admin, side, orgId, viewer);
    if (caps.role !== null || hasAnyCapability(caps)) return 'member';
    const { data: entry } = await admin
      .from('competition_entries')
      .select('id')
      .eq('competition_id', input.competition.id)
      .eq('profile_id', viewer)
      .limit(1)
      .maybeSingle();
    if (entry) return 'member';
    if (input.teamIds.length > 0) {
      const { data: roster } = await admin
        .from('memberships')
        .select('id')
        .eq('scope_type', 'team')
        .in('scope_id', input.teamIds)
        .eq('profile_id', viewer)
        .limit(1)
        .maybeSingle();
      if (roster) return 'member';
    }
  } catch (err) {
    console.error(`${TAG} access read failed:`, err);
  }
  return null;
}

// ── The reader ─────────────────────────────────────────────────────────────

interface ContestRow {
  id: string;
  competition_id: string;
  event_id: string | null;
  venue_id: string | null;
  facility_id: string | null;
  scheduled_at: string | null;
  round: string | null;
  status: string;
  holes?: number | null;
  play_from?: string | null;
  play_to?: string | null;
}

interface CompetitionRow {
  id: string;
  league_id: string | null;
  club_id: string | null;
  season_id: string | null;
  sport_key: string;
  name: string;
  format: string;
  entrant_type: string;
  scoring_rule: string | null;
  status: string;
  visibility: string;
}

const CONTEST_FIELDS_BASE = 'id, competition_id, event_id, venue_id, facility_id, scheduled_at, round, status';
const COMP_FIELDS = 'id, league_id, club_id, season_id, sport_key, name, format, entrant_type, scoring_rule, status, visibility';

export async function fetchContestView(
  admin: Admin,
  contestId: string,
  opts: { viewerId: string | null }
): Promise<ContestViewResult | null> {
  try {
    // Contest (the 172 golf columns ride the read; pre-172 retries without).
    const readContest = (fields: string) =>
      admin.from('contests').select(fields).eq('id', contestId).maybeSingle();
    let { data: contestData, error: contestError } = await readContest(`${CONTEST_FIELDS_BASE}, holes, play_from, play_to`);
    if (contestError?.code === '42703') {
      ({ data: contestData, error: contestError } = await readContest(CONTEST_FIELDS_BASE));
    }
    if (contestError) {
      if (!isMissingTableError(contestError.code)) console.error(`${TAG} contest read error:`, contestError);
      return null;
    }
    const contest = contestData as unknown as ContestRow | null;
    if (!contest) return null;

    const { data: compData, error: compError } = await admin
      .from('competitions')
      .select(COMP_FIELDS)
      .eq('id', contest.competition_id)
      .maybeSingle();
    if (compError || !compData) return null;
    const comp = compData as unknown as CompetitionRow;
    const side: OrgSide = comp.league_id ? 'league' : 'club';
    const orgId = comp.league_id ?? comp.club_id;
    if (!orgId) return null;

    // Participants + entries first: access needs the entered teams.
    const { data: participantRows } = await admin
      .from('contest_participants')
      .select('id, entry_id, side, start_position')
      .eq('contest_id', contestId)
      .limit(500);
    const participants = (participantRows ?? []) as {
      id: string; entry_id: string; side: string | null; start_position: number | null;
    }[];
    const entryIds = [...new Set(participants.map(p => p.entry_id))];
    const { data: entryRows } = entryIds.length
      ? await admin.from('competition_entries').select('id, team_id, profile_id').in('id', entryIds)
      : { data: [] };
    const entryById = new Map(
      ((entryRows ?? []) as { id: string; team_id: string | null; profile_id: string | null }[]).map(e => [e.id, e])
    );

    const [orgAccess, orgRow] = await Promise.all([
      readOrgAccess(admin, side, orgId),
      admin.from(side === 'league' ? 'leagues' : 'clubs').select('id, name').eq('id', orgId).maybeSingle(),
    ]);
    if (!orgRow.data) return null;

    const teamIdsEntered = [...new Set([...entryById.values()].map(e => e.team_id).filter((v): v is string => !!v))];
    const access = await resolveContestAccess(admin, {
      competition: { id: comp.id, visibility: comp.visibility, leagueId: comp.league_id, clubId: comp.club_id },
      orgAccess,
      viewerId: opts.viewerId,
      teamIds: teamIdsEntered,
    });
    if (!access) return null;

    // The rest, in parallel: results, stat lines, media ids, the mirror
    // event's timezone, venue / facility / season names.
    const [resultsRes, linesRes, mediaRes, eventRes, venueRes, facilityRes, seasonRes] = await Promise.all([
      participants.length
        ? admin
            .from('contest_results')
            .select('participant_id, score, payload, provenance, dispute_status')
            .eq('contest_id', contestId)
            .limit(500)
        : Promise.resolve({ data: [] as never[] }),
      admin
        .from('contest_stat_lines')
        .select('team_id, profile_id, stats, provenance')
        .eq('contest_id', contestId)
        .limit(500),
      admin.from('contest_media').select('id').eq('contest_id', contestId).eq('published', true).limit(100),
      contest.event_id
        ? admin.from('events').select('timezone').eq('id', contest.event_id).maybeSingle()
        : Promise.resolve({ data: null }),
      contest.venue_id
        ? admin.from('venues').select('name, golf_course_id').eq('id', contest.venue_id).maybeSingle()
        : Promise.resolve({ data: null }),
      contest.facility_id
        ? admin.from('facilities').select('name').eq('id', contest.facility_id).maybeSingle()
        : Promise.resolve({ data: null }),
      comp.season_id
        ? admin.from('seasons').select('label').eq('id', comp.season_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const results = (resultsRes.data ?? []) as {
      participant_id: string; score: number | null; payload: Record<string, unknown> | null; provenance: string; dispute_status: string;
    }[];
    const resultByParticipant = new Map(results.map(r => [r.participant_id, r]));
    const lines = (linesRes.data ?? []) as {
      team_id: string | null; profile_id: string; stats: Record<string, number> | null; provenance: string;
    }[];

    // Names: teams (with their club for the sanction tier) + profiles (with
    // the masking inputs — they stop at projectContestView).
    const teamIds = [...new Set([...teamIdsEntered, ...lines.map(l => l.team_id).filter((v): v is string => !!v)])];
    const profileIds = [
      ...new Set([
        ...[...entryById.values()].map(e => e.profile_id).filter((v): v is string => !!v),
        ...lines.map(l => l.profile_id),
      ]),
    ];
    const [teamsRes, profilesRes] = await Promise.all([
      teamIds.length
        ? admin.from('teams').select('id, name, display_name, club_id').in('id', teamIds)
        : Promise.resolve({ data: [] as never[] }),
      profileIds.length
        ? admin
            .from('profiles')
            .select('id, first_name, last_name, full_name, visibility, email, supervision_state, handle')
            .in('id', profileIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    const teamById = new Map(
      ((teamsRes.data ?? []) as { id: string; name: string; display_name: string | null; club_id: string | null }[]).map(t => [
        t.id,
        { name: t.display_name || t.name || 'Team', clubId: t.club_id },
      ])
    );
    const profileById = new Map(
      ((profilesRes.data ?? []) as RawProfile[]).map(p => [p.id, p])
    );

    const clubIds = [...new Set([...teamById.values()].map(t => t.clubId).filter((v): v is string => !!v))];
    const sanctionedPairs = comp.league_id ? await readSanctionedPairs(admin, [comp.league_id], clubIds) : new Set<string>();

    // Course name for a golf round (the mirror's convention).
    let courseName: string | null = null;
    const venue = venueRes.data as { name: string | null; golf_course_id: string | null } | null;
    if (venue?.golf_course_id) {
      const { data: course } = await admin.from('golf_courses').select('name').eq('id', venue.golf_course_id).maybeSingle();
      courseName = (course?.name as string | undefined) ?? null;
    }

    // Media: the gallery gate decides; the proxy route self-gates the bytes.
    const mediaIds = ((mediaRes.data ?? []) as { id: string }[]).map(m => m.id);
    const eligible = await evaluatePublicContestMedia(admin, mediaIds);
    const media: ContestMediaItem[] = eligible.map(m => ({
      id: m.id,
      url: `/api/media/contest-media/${m.id}`,
      mediaType: m.mediaType,
      caption: m.caption,
      createdAt: m.createdAt,
    }));

    // Live round: the golf sync's payload.roundRef (E2 moves this to the
    // group_posts.contest_id column). Public rounds link for everyone;
    // otherwise the shared-round rule with the viewer.
    let liveRound: { groupPostId: string } | null = null;
    const groupPostId = results
      .map(r => (r.payload?.roundRef as { groupPostId?: string | null } | undefined)?.groupPostId ?? null)
      .find((v): v is string => typeof v === 'string' && v.length > 0);
    if (groupPostId) {
      const { data: gp } = await admin
        .from('group_posts')
        .select('id, creator_id, visibility, status')
        .eq('id', groupPostId)
        .maybeSingle();
      if (gp && gp.status !== 'cancelled') {
        let canView = gp.visibility === 'public';
        if (!canView && opts.viewerId) {
          const { data: gpp } = await admin
            .from('group_post_participants')
            .select('profile_id')
            .eq('group_post_id', groupPostId);
          canView = canViewSharedRound({
            viewerId: opts.viewerId,
            creatorId: (gp.creator_id as string | null) ?? null,
            visibility: gp.visibility as string | null,
            participantProfileIds: ((gpp ?? []) as { profile_id: string }[]).map(p => p.profile_id),
          });
        }
        if (canView) liveRound = { groupPostId };
      }
    }

    const sportName = (SPORT_REGISTRY as Record<string, { display_name: string } | undefined>)[comp.sport_key as SportKey]?.display_name ?? comp.sport_key;

    const raw: RawContestRecord = {
      contest: {
        id: contest.id,
        status: contest.status,
        round: contest.round,
        scheduledAt: contest.scheduled_at,
        timezone: ((eventRes.data as { timezone?: string | null } | null)?.timezone ?? null) || 'UTC',
        holes: contest.holes ?? null,
        playFrom: contest.play_from ?? null,
        playTo: contest.play_to ?? null,
        eventId: contest.event_id,
        venueName: venue?.name ?? null,
        facilityName: ((facilityRes.data as { name?: string | null } | null)?.name ?? null) || null,
        courseName,
      },
      competition: {
        id: comp.id,
        name: comp.name,
        format: comp.format,
        entrantType: comp.entrant_type,
        sportKey: comp.sport_key,
        sportName,
        scoringRule: comp.scoring_rule,
        status: comp.status,
        visibility: comp.visibility,
        seasonLabel: ((seasonRes.data as { label?: string | null } | null)?.label ?? null) || null,
      },
      org: { side, id: orgId, name: (orgRow.data as { name: string }).name },
      ownerLeagueId: comp.league_id,
      sanctionedPairs,
      entrants: participants.map(p => {
        const entry = entryById.get(p.entry_id);
        const team = entry?.team_id ? teamById.get(entry.team_id) : undefined;
        const r = resultByParticipant.get(p.id);
        return {
          participantId: p.id,
          entryId: p.entry_id,
          side: p.side === 'home' || p.side === 'away' ? p.side : null,
          startPosition: p.start_position,
          teamId: entry?.team_id ?? null,
          teamName: team?.name ?? (entry?.team_id ? 'Team' : null),
          teamClubId: team?.clubId ?? null,
          profile: entry?.profile_id ? (profileById.get(entry.profile_id) ?? null) : null,
          result: r
            ? { score: r.score, provenance: r.provenance, disputeStatus: r.dispute_status, payload: r.payload }
            : null,
        };
      }),
      statLines: lines.map(l => {
        const team = l.team_id ? teamById.get(l.team_id) : undefined;
        return {
          teamId: l.team_id,
          teamName: team?.name ?? null,
          teamClubId: team?.clubId ?? null,
          profile: profileById.get(l.profile_id) ?? null,
          stats: l.stats ?? {},
          provenance: l.provenance,
        };
      }),
      media,
      liveRound,
    };

    return { access, view: projectContestView(raw) };
  } catch (err) {
    console.error(`${TAG} failed:`, err);
    return null;
  }
}

