import { describe, expect, it } from 'vitest';
import { projectContestView, type RawContestRecord, type RawProfile } from '../contest-view';

const profile = (over: Partial<RawProfile> & { id: string }): RawProfile => ({
  first_name: 'Jordan',
  last_name: 'Baker',
  full_name: 'Jordan Baker',
  visibility: 'public',
  email: `${over.id}@example.com`,
  supervision_state: 'self',
  handle: over.id,
  ...over,
});

const base = (over: Partial<RawContestRecord> = {}): RawContestRecord => ({
  contest: {
    id: 'c1', status: 'completed', round: 'Week 1', scheduledAt: '2026-09-10T18:00:00Z', timezone: 'America/Toronto',
    holes: null, playFrom: null, playTo: null, eventId: null, venueName: 'Rink', facilityName: null, courseName: null,
  },
  competition: {
    id: 'comp', name: 'House League', format: 'fixture', entrantType: 'team', sportKey: 'ice_hockey', sportName: 'Ice Hockey',
    scoringRule: null, status: 'active', visibility: 'public', seasonLabel: '2026-27',
  },
  org: { side: 'league', id: 'L1', name: 'KMHA' },
  ownerLeagueId: 'L1',
  sanctionedPairs: new Set(['L1:C1']),
  entrants: [],
  statLines: [],
  media: [],
  liveRound: null,
  ...over,
});

describe('projectContestView', () => {
  it('derives the sanctioned tier from the owner→club pair and leaves other rungs alone', () => {
    const view = projectContestView(base({
      entrants: [
        { participantId: 'p1', entryId: 'e1', side: 'home', startPosition: null, teamId: 't1', teamName: 'Blazers', teamClubId: 'C1', profile: null,
          result: { score: 3, provenance: 'league_verified', disputeStatus: 'none', payload: null } },
        { participantId: 'p2', entryId: 'e2', side: 'away', startPosition: null, teamId: 't2', teamName: 'Comets', teamClubId: 'C2', profile: null,
          result: { score: 2, provenance: 'league_verified', disputeStatus: 'disputed', payload: null } },
        { participantId: 'p3', entryId: 'e3', side: null, startPosition: null, teamId: 't3', teamName: 'Late', teamClubId: 'C1', profile: null, result: null },
      ],
    }));
    expect(view.entrants[0].result?.provenance).toBe('sanctioned');
    expect(view.entrants[1].result?.provenance).toBe('league_verified');
    expect(view.entrants[1].result?.disputeStatus).toBe('disputed');
    expect(view.entrants[2].result).toBeNull();
    expect(view.entrants[0].isTeam).toBe(true);
    expect(view.outcome.kind).toBe('fixture');
    if (view.outcome.kind === 'fixture') expect(view.outcome.scoreline).toBe('3–2');
  });

  it('never sanctions when the owner is a club', () => {
    const view = projectContestView(base({
      ownerLeagueId: null,
      org: { side: 'club', id: 'C1', name: 'Club' },
      entrants: [{ participantId: 'p1', entryId: 'e1', side: 'home', startPosition: null, teamId: 't1', teamName: 'A', teamClubId: 'C1', profile: null,
        result: { score: 1, provenance: 'league_verified', disputeStatus: 'none', payload: null } }],
    }));
    expect(view.entrants[0].result?.provenance).toBe('league_verified');
  });

  it('masks names by the public-profile rule and links only public profiles', () => {
    const view = projectContestView(base({
      competition: { ...base().competition, format: 'leaderboard', entrantType: 'athlete', sportKey: 'golf', scoringRule: 'golf_net' },
      entrants: [
        { participantId: 'p1', entryId: 'e1', side: null, startPosition: null, teamId: null, teamName: null, teamClubId: null,
          profile: profile({ id: 'pub' }), result: { score: 68, provenance: 'self_reported', disputeStatus: 'none', payload: { gross: 70, net: 68 } } },
        { participantId: 'p2', entryId: 'e2', side: null, startPosition: null, teamId: null, teamName: null, teamClubId: null,
          profile: profile({ id: 'kid', first_name: 'Sam', last_name: 'Minor', full_name: 'Sam Minor', supervision_state: 'supervised' }),
          result: { score: 72, provenance: 'self_reported', disputeStatus: 'none', payload: null } },
        { participantId: 'p3', entryId: 'e3', side: null, startPosition: null, teamId: null, teamName: null, teamClubId: null,
          profile: profile({ id: 'stub', first_name: 'Pat', last_name: 'Stub', full_name: 'Pat Stub', email: 'stub-1@stubs.invalid' }),
          result: null },
        { participantId: 'p4', entryId: 'e4', side: null, startPosition: null, teamId: null, teamName: null, teamClubId: null,
          profile: profile({ id: 'priv', first_name: 'Lee', last_name: 'Private', full_name: 'Lee Private', visibility: 'private' }),
          result: null },
      ],
      statLines: [
        { teamId: null, teamName: null, teamClubId: null, profile: profile({ id: 'kid', first_name: 'Sam', last_name: 'Minor', full_name: 'Sam Minor', supervision_state: 'supervised' }),
          stats: { goals: 2 }, provenance: 'club_recorded' },
      ],
    }));
    const byId = Object.fromEntries(view.entrants.map(e => [e.participantId, e]));
    expect(byId.p1.name).toBe('Jordan Baker');
    expect(byId.p1.handle).toBe('pub');
    expect(byId.p2.name).toBe('Sam M.');
    expect(byId.p2.handle).toBeNull();
    expect(byId.p3.name).toBe('Pat S.');
    expect(byId.p3.handle).toBeNull();
    expect(byId.p4.name).toBe('Lee P.');
    expect(byId.p4.handle).toBeNull();
    expect(view.statLines[0].name).toBe('Sam M.');
    expect(view.statLines[0].handle).toBeNull();
    expect(view.entrants.every(e => e.isTeam === false)).toBe(true);
    if (view.outcome.kind === 'leaderboard') {
      expect(view.outcome.rows[0].name).toBe('Jordan Baker');
      expect(view.outcome.rows[0].stats).toEqual({ gross: 70 });
    }
  });

  it('lets nothing private out: no emails, supervision state, profile ids or club ids in the view', () => {
    const view = projectContestView(base({
      entrants: [{ participantId: 'p1', entryId: 'e1', side: 'home', startPosition: null, teamId: 't1', teamName: 'A', teamClubId: 'C1',
        profile: profile({ id: 'secret-profile-id', email: 'hidden@example.com', supervision_state: 'supervised' }),
        result: { score: 1, provenance: 'club_recorded', disputeStatus: 'none', payload: { note: 'ok' } } }],
      statLines: [{ teamId: 't1', teamName: 'A', teamClubId: 'C1', profile: profile({ id: 'line-profile', handle: 'liner', email: 'line@example.com' }), stats: { goals: 1 }, provenance: 'club_recorded' }],
    }));
    const json = JSON.stringify(view);
    for (const leak of ['hidden@example.com', 'line@example.com', 'supervised', 'secret-profile-id', 'line-profile', 'teamClubId', 'C1', '"t1"', 'email']) {
      expect(json, leak).not.toContain(leak);
    }
    expect(view.statFields.map(f => f.key)).toContain('goals');
  });
});
