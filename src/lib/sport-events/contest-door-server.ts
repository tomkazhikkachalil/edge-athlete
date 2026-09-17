/**
 * The contest → event door (Competition formats, track 2, PR 10 + PR 11):
 * an org's two-sided contest RUNS AS a one-round event of the competition's
 * sport, hosted for the org, its sides pre-filled from the two entries'
 * members, through track 1's create shape (the same rows the create route
 * writes: the header, the round snapshot, the host as a non-playing
 * organizer, the members accepted and playing, ONE group with the sides
 * SENT), then `contests.sport_event_round_id` stamped through the link
 * server (the ONE writer). Two kinds:
 *   game  — a fixture of named sides (or teams) in a stat-line sport → a
 *           GAME event (PR 10); the live score becomes the result.
 *   match — a GOLF BRACKET contest (athletes → singles; ad-hoc pairs →
 *           four-ball) → a MATCH-PLAY round (PR 11); at go-live the minted
 *           match is stamped into `sport_event_match_id` (220) and the
 *           closed match becomes the result (winner 1, loser 0).
 * The event is published (open) at once; the round's live / completed
 * status flows back through `syncContestStatus`, the result through
 * `syncGameContest` / `syncMatchContests`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { revalidateOrgSiteForCompetition } from '@/lib/org-sites/revalidate';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { EVENT_COLUMNS } from './access-server';
import { LINK_REFUSAL_COPY, type LinkRefusal } from './contest-link';
import { linkContestToRound } from './contest-link-server';
import { snapshotAtAccept } from './handicap-server';
import { applyTransition } from './lifecycle-server';
import { snapshotRound } from './rounds-server';
import { SPORT_EVENT_SPORTS_ALL, type SportEventParticipantRow, type SportEventRow } from './types';
import { teamRosterMembers } from './side-prefill-server';
import { splitSides } from './game';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[contest-door]';

export interface ContestRunAsEventInput {
  competitionId: string;
  contestId: string;
  scheduledOn: string;
  startsAt?: string;
  place?: string;
  /** PR 11: a golf bracket match's course (optional — a place alone plays gross off par 4). */
  courseId?: string;
  /** PR 11: gross or net match play (default gross). */
  format?: 'match_gross' | 'match_net';
  selfEntry: boolean;
  visibility: 'public' | 'private';
}

type SideEntry = { id: string; team_id: string | null; profile_id: string | null; name: string | null };

const refuse = (reason: LinkRefusal, status: number) => NextResponse.json({ error: LINK_REFUSAL_COPY[reason], reason }, { status });

/** A side's players: an athlete entry's one profile, an ad-hoc entry's members, or a team's team-scope roster under the org. */
async function sideMembers(admin: Admin, entry: SideEntry, org: { col: 'league_id' | 'club_id'; id: string }): Promise<string[]> {
  if (entry.profile_id) return [entry.profile_id];
  if (entry.team_id) return teamRosterMembers(admin, org, entry.team_id);
  const { data } = await admin.from('competition_entry_members').select('profile_id, position').eq('entry_id', entry.id).order('position', { ascending: true });
  return [...new Set(((data ?? []) as Array<{ profile_id: string }>).map(r => r.profile_id))];
}

export async function contestRunAsEventPOST(admin: Admin, input: ContestRunAsEventInput, scope: { side: 'club' | 'league'; orgId: string }, userId: string): Promise<NextResponse> {
  const { data: contestRow, error: readError } = await admin
    .from('contests')
    .select('id, status, round, scheduled_at, sport_event_round_id, competition:competition_id (id, name, league_id, club_id, sport_key, format, entrant_type, status)')
    .eq('id', input.contestId)
    .maybeSingle();
  if (readError) {
    if (readError.code === '42703') return NextResponse.json({ error: 'Running a game as an event needs migration 211.', reason: 'needs_migration' }, { status: 409 });
    return NextResponse.json({ error: 'Failed to read the game' }, { status: 500 });
  }
  type CompLite = { id: string; name: string; league_id: string | null; club_id: string | null; sport_key: string; format: string; entrant_type: string; status: string };
  const compRaw = contestRow?.competition as CompLite | CompLite[] | null | undefined;
  const comp = Array.isArray(compRaw) ? compRaw[0] : compRaw;
  const orgCol = scope.side === 'league' ? 'league_id' : 'club_id';
  if (!contestRow || !comp || comp.id !== input.competitionId || comp[orgCol] !== scope.orgId) return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  // The kind: a fixture of sides in a stat-line sport is a GAME; a golf bracket contest is a MATCH; anything else has no event.
  const kind: 'game' | 'match' | null =
    comp.format === 'fixture' && (comp.entrant_type === 'ad_hoc_team' || comp.entrant_type === 'team') && comp.sport_key !== 'golf' ? 'game'
    : comp.format === 'bracket' && comp.sport_key === 'golf' ? 'match'
    : null;
  if (!kind) return refuse('not_a_game', 400);
  if (!(SPORT_EVENT_SPORTS_ALL as readonly string[]).includes(comp.sport_key)) return refuse('sport_unsupported', 400);
  if (contestRow.status === 'completed' || contestRow.status === 'canceled') return refuse('contest_over', 409);
  if (contestRow.sport_event_round_id) return refuse('already_linked', 409);

  const { data: parts } = await admin.from('contest_participants').select('side, entry:entry_id (id, team_id, profile_id, name)').eq('contest_id', input.contestId);
  const sideOf = (side: 'home' | 'away'): SideEntry | null => {
    const p = (parts ?? []).find(x => x.side === side);
    const e = p ? ((Array.isArray(p.entry) ? p.entry[0] : p.entry) as SideEntry | null) : null;
    return e ?? null;
  };
  const home = sideOf('home');
  const away = sideOf('away');
  if (!home || !away || (parts ?? []).length !== 2) return refuse('not_two_sided', 400);
  const org = { col: orgCol, id: scope.orgId } as const;
  const [homeMembers, awayMembers] = await Promise.all([sideMembers(admin, home, org), sideMembers(admin, away, org)]);
  const [homeOnly] = splitSides(homeMembers, awayMembers);
  // A match's sides: one a side (singles) or two (four-ball) — never uneven.
  let matchSides: 'singles' | 'fourball' | null = null;
  if (kind === 'match') {
    if (homeOnly.length === 1 && awayMembers.length === 1) matchSides = 'singles';
    else if (homeOnly.length === 2 && awayMembers.length === 2) matchSides = 'fourball';
    else return refuse('side_size', 400);
  }

  // The side names: a team's name, an ad-hoc side's name, an athlete's (masked) name.
  const teamIds = [home.team_id, away.team_id].filter((id): id is string => !!id);
  const profileIds = [home.profile_id, away.profile_id].filter((id): id is string => !!id);
  const [{ data: teams }, { data: profiles }] = await Promise.all([
    teamIds.length ? admin.from('teams').select('id, name, display_name').in('id', teamIds) : Promise.resolve({ data: [] }),
    profileIds.length ? admin.from('profiles').select('id, first_name, last_name, full_name, visibility, email, supervision_state, handle').in('id', profileIds) : Promise.resolve({ data: [] }),
  ]);
  const teamName = new Map(((teams ?? []) as Array<{ id: string; name: string; display_name: string | null }>).map(t => [t.id, (t.display_name || t.name) as string]));
  const profileName = new Map(((profiles ?? []) as Array<MaskableProfile & { id: string }>).map(p => [p.id, publicDisplayName(p)]));
  const nameOf = (e: SideEntry) => (e.team_id ? (teamName.get(e.team_id) ?? 'Team') : e.profile_id ? (profileName.get(e.profile_id) ?? 'Athlete') : (e.name ?? 'Side'));
  const sideNames: [string, string] = [nameOf(home).slice(0, 40), nameOf(away).slice(0, 40)];

  // The event: the create route's rows, hosted for the org by the manager who opened the door (organizes; plays only as a member).
  const snap = await snapshotRound(admin, { scheduled_on: input.scheduledOn, name: contestRow.round ?? null, course_id: kind === 'match' ? (input.courseId ?? null) : null, course_name: input.place ?? (kind === 'match' ? 'Course' : `${sideNames[0]} vs ${sideNames[1]}`), tee: null, holes: 18, starting_hole: 1, starts_at: input.startsAt ?? null });
  if (!snap) return NextResponse.json({ error: 'Course not found' }, { status: 400 });
  const now = new Date().toISOString();
  const format = kind === 'match' ? (input.format ?? 'match_gross') : 'stroke_gross';
  const { data: event, error: insertError } = await admin
    .from('sport_events')
    .insert({
      host_profile_id: userId,
      created_by_user_id: userId,
      club_id: scope.side === 'club' ? scope.orgId : null,
      league_id: scope.side === 'league' ? scope.orgId : null,
      sport_key: comp.sport_key,
      name: `${sideNames[0]} vs ${sideNames[1]}`.slice(0, 120),
      description: `${comp.name}${contestRow.round ? ` · ${contestRow.round}` : ''}`.slice(0, 2000),
      join_mode: 'invite',
      visibility: input.visibility,
      link_token: null,
      format,
      shape: kind === 'match' ? 'round' : 'game',
      status: 'draft',
      capacity: null,
      self_entry: input.selfEntry,
      starts_on: input.scheduledOn,
      format_config: kind === 'match' ? { match: { sides: matchSides, bracket: false } } : { game: { side_names: sideNames } },
    })
    .select(EVENT_COLUMNS)
    .single();
  if (insertError || !event) {
    console.error(`${TAG} event insert failed:`, insertError);
    return NextResponse.json({ error: 'Could not create the event' }, { status: 500 });
  }
  const row = event as SportEventRow;
  const undo = async () => { await admin.from('sport_events').delete().eq('id', row.id); };

  const { data: round, error: roundError } = await admin.from('sport_event_rounds').insert({ sport_event_id: row.id, sequence: 1, ...snap }).select('id').single();
  if (roundError || !round) {
    console.error(`${TAG} round insert failed:`, roundError);
    await undo();
    return NextResponse.json({ error: 'Could not create the round' }, { status: 500 });
  }
  const roundId = (round as { id: string }).id;

  // The people: the host as an organizer (playing only as a member), every member accepted and playing; a golf player's index snapshotted at accept.
  const members = [...new Set([...homeOnly, ...awayMembers])];
  const hostPlays = members.includes(userId);
  const rows = [
    { sport_event_id: row.id, profile_id: userId, role: 'organizer', status: 'accepted', playing: hostPlays, accepted_at: now, responded_at: now },
    ...members.filter(p => p !== userId).map(profile_id => ({ sport_event_id: row.id, profile_id, role: 'participant', status: 'accepted', playing: true, accepted_at: now, responded_at: now })),
  ];
  const { data: people, error: peopleError } = await admin.from('sport_event_participants').insert(rows).select('id, profile_id, playing, handicap_index, handicap_source');
  if (peopleError || !people) {
    console.error(`${TAG} participants insert failed:`, peopleError);
    await undo();
    return NextResponse.json({ error: 'Could not add the players' }, { status: 500 });
  }
  const peopleRows = (people ?? []) as Array<Pick<SportEventParticipantRow, 'id' | 'profile_id' | 'handicap_index' | 'handicap_source'> & { playing: boolean }>;
  if (kind === 'match') for (const p of peopleRows) if (p.playing) await snapshotAtAccept(admin, p);
  const participantOf = new Map(peopleRows.map(p => [p.profile_id, p.id]));

  // ONE group, the sides SENT (a game's groups carry sent sides; a match's too — never derived).
  const { data: group, error: groupError } = await admin.from('sport_event_groups').insert({ sport_event_round_id: roundId, sequence: 1, name: kind === 'match' ? 'Match 1' : 'The game', starting_hole: 1, tee_time: input.startsAt ?? null }).select('id').single();
  if (groupError || !group) {
    console.error(`${TAG} group insert failed:`, groupError);
    await undo();
    return NextResponse.json({ error: 'Could not draw the sides' }, { status: 500 });
  }
  const memberRows = [...homeOnly.map(p => ({ profile_id: p, side: 1 })), ...awayMembers.map(p => ({ profile_id: p, side: 2 }))]
    .map((m, i) => ({ group_id: (group as { id: string }).id, sport_event_round_id: roundId, participant_id: participantOf.get(m.profile_id) as string, position: i + 1, side: m.side }))
    .filter(m => !!m.participant_id);
  if (memberRows.length > 0) {
    const { error: memberError } = await admin.from('sport_event_group_members').insert(memberRows);
    if (memberError) console.error(`${TAG} group members insert failed:`, memberError);
  }

  const linked = await linkContestToRound(admin, input.contestId, roundId);
  if (linked !== 'ok') {
    await undo();
    if (linked === 'already_linked') return refuse('already_linked', 409);
    return NextResponse.json({ error: 'Running a game as an event needs migration 211.', reason: 'needs_migration' }, { status: 409 });
  }
  const opened = await applyTransition(admin, { eventId: row.id, to: 'open', actorProfileId: userId });
  if (!opened.ok) console.error(`${TAG} publish failed:`, opened.reason, opened.error);
  await revalidateOrgSiteForCompetition(admin, comp.id);
  return NextResponse.json({ event_id: row.id, round_id: roundId, kind, sides: sideNames, players: members.length, ...(matchSides ? { match_sides: matchSides } : {}) }, { status: 201 });
}
