import { expect } from '@playwright/test';
import { adminClient, loadQaUser } from './qa-user';

// Contest Place (Sep 2026): one seed for the contest-page specs — a league
// (owner = QA user B, member = QA user A) with a PUBLIC and a PRIVATE
// fixture competition, each holding one completed contest with a result
// on both sides. The caller deletes the league (cascades everything).

export interface SeededContestLeague {
  leagueId: string;
  stamp: number;
  publicContest: string;
  privateContest: string;
  ownerEmail: string;
}

export async function seedContestLeague(): Promise<SeededContestLeague> {
  const member = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Place League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    { league_id: leagueId, profile_id: member.id, role: 'member' },
  ]);
  const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: '2026-27' }).select().single();
  const { data: teams } = await admin
    .from('teams')
    .insert([{ league_id: leagueId, name: `Blazers ${stamp}` }, { league_id: leagueId, name: `Comets ${stamp}` }])
    .select();
  const [home, away] = teams!;

  const seed = async (visibility: 'public' | 'private', homeScore: number, awayScore: number) => {
    const { data: comp } = await admin
      .from('competitions')
      .insert({
        league_id: leagueId, season_id: season!.id, sport_key: 'ice_hockey', name: `${visibility} League`,
        format: 'fixture', entrant_type: 'team', status: 'active', visibility,
      })
      .select()
      .single();
    const { data: entries } = await admin
      .from('competition_entries')
      .insert([{ competition_id: comp!.id, team_id: home.id, status: 'approved' }, { competition_id: comp!.id, team_id: away.id, status: 'approved' }])
      .select();
    const { data: contest } = await admin
      .from('contests')
      .insert({ competition_id: comp!.id, scheduled_at: new Date(stamp - 86_400_000).toISOString(), round: 'Week 1', status: 'completed' })
      .select()
      .single();
    const { data: parts } = await admin
      .from('contest_participants')
      .insert([
        { contest_id: contest!.id, entry_id: entries!.find(e => e.team_id === home.id)!.id, side: 'home' },
        { contest_id: contest!.id, entry_id: entries!.find(e => e.team_id === away.id)!.id, side: 'away' },
      ])
      .select();
    const { error: resErr } = await admin.from('contest_results').insert([
      { contest_id: contest!.id, participant_id: parts!.find(p => p.side === 'home')!.id, score: homeScore, payload: {}, provenance: 'league_verified', entered_by: owner.id },
      { contest_id: contest!.id, participant_id: parts!.find(p => p.side === 'away')!.id, score: awayScore, payload: {}, provenance: 'league_verified', entered_by: owner.id },
    ]);
    expect(resErr, resErr?.message).toBeNull();
    return contest!.id as string;
  };
  return {
    leagueId,
    stamp,
    publicContest: await seed('public', 3, 2),
    privateContest: await seed('private', 1, 4),
    ownerEmail: owner.email,
  };
}
