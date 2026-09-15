import { describe, expect, it } from 'vitest';
import { contestResultFor, contestRule, contestStatusFor, provenanceForOrg, type ContestResultInput } from '../contest-sync';

const input: ContestResultInput = { contestId: 'k', participantId: 'p', rule: 'golf_net', provenance: 'club_recorded', enteredBy: 'host', holes: 18, tee: 'white', golfRoundId: 'gr1', groupPostId: 'gp1', eventId: 'e1', roundId: 'r1' };

describe('contestResultFor — the event\'s row into the org\'s contest', () => {
  it('a net rule scores net when a net exists, gross otherwise (flagged); the org\'s provenance; roundRef names the mirrored round', () => {
    const net = contestResultFor({ gross: 80, net: 68, courseHandicap: 12, netReason: null }, input)!;
    expect(net).toMatchObject({ contest_id: 'k', participant_id: 'p', score: 68, provenance: 'club_recorded', entered_by: 'host' });
    expect(net.payload).toMatchObject({ gross: 80, net: 68, courseHandicap: 12, holes: 18, holesSource: 'card', tee: 'white', roundRef: { roundId: 'gr1', groupPostId: 'gp1' }, sportEvent: { eventId: 'e1', roundId: 'r1' } });
    const noIndex = contestResultFor({ gross: 80, net: null, courseHandicap: null, netReason: 'no_index' }, input)!;
    expect(noIndex.score).toBe(80);
    expect(noIndex.payload.noIndex).toBe(true);
    expect(noIndex.payload.net).toBeUndefined();
    const noRating = contestResultFor({ gross: 80, net: null, courseHandicap: null, netReason: 'no_rating' }, { ...input, rule: 'golf_gross' })!;
    expect(noRating.payload.noRating).toBe(true);
    expect(contestResultFor({ gross: 80, net: 68, courseHandicap: 12, netReason: null }, { ...input, rule: 'golf_gross' })!.score).toBe(80);
  });
  it('an opted-out player still counts: roundRef.roundId null, groupPostId set; a never-scored row is null', () => {
    const out = contestResultFor({ gross: 77, net: 70, courseHandicap: 7, netReason: null }, { ...input, golfRoundId: null })!;
    expect(out.payload.roundRef).toEqual({ roundId: null, groupPostId: 'gp1' });
    expect(out.score).toBe(70);
    expect(contestResultFor({ gross: null, net: null, courseHandicap: null, netReason: null }, input)).toBeNull();
  });
  it('rule, provenance and status mappings', () => {
    expect(contestRule('golf_net')).toBe('golf_net');
    expect(contestRule('golf_gross')).toBe('golf_gross');
    expect(contestRule('stroke_total')).toBe('stroke_total');
    expect(contestRule(null)).toBe('golf_gross');
    expect(provenanceForOrg({ side: 'club' })).toBe('club_recorded');
    expect(provenanceForOrg({ side: 'league' })).toBe('league_verified');
    expect(['scheduled', 'live', 'completed', 'cancelled'].map(s => contestStatusFor(s as 'scheduled'))).toEqual(['scheduled', 'in_progress', 'completed', 'canceled']);
  });
});
