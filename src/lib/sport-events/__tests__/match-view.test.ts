import { describe, expect, it } from 'vitest';
import { computeMatch, type MatchInput } from '../match';
import { matchLine, matchTitle, projectMatch, sideOfViewer, type MatchSideProjection } from '../match-view';

const member = (id: string, name: string) => ({ participant_id: id, profile_id: `pf-${id}`, name, handle: null, avatar_url: null });
const side = (s: 1 | 2, members: ReturnType<typeof member>[]): MatchSideProjection => ({ side: s, members, card_participant_ids: members.map(m => m.participant_id) });

describe('the match view', () => {
  it('titles by the group name or "Match n"; the line is "A vs B" / "A & B vs C & D" / "A · bye"', () => {
    expect(matchTitle({ sequence: 3, name: null })).toBe('Match 3');
    expect(matchTitle({ sequence: 3, name: ' Final ' })).toBe('Final');
    expect(matchLine([side(1, [member('a', 'Ann')]), side(2, [member('b', 'Bob')])])).toBe('Ann vs Bob');
    expect(matchLine([side(1, [member('a', 'Ann'), member('c', 'Al')]), side(2, [member('b', 'Bob'), member('d', 'Ben')])])).toBe('Ann & Al vs Bob & Ben');
    expect(matchLine([side(1, [member('a', 'Ann')]), side(2, [])])).toBe('Ann · bye');
  });
  it('projects the computed state and the intent, never a hole score; the viewer\'s side is by profile', () => {
    const input: MatchInput = {
      format: 'match_gross', sides: 'singles', allowancePct: 100, holes: 9, holeOrder: [1, 2, 3, 4, 5, 6, 7, 8, 9], holeData: null,
      sideA: { side: 1, players: [{ participantId: 'a', profileId: 'pf-a', name: 'Ann', position: 1, courseHandicap: null, holeScores: [{ hole_number: 1, strokes: 4 }] }] },
      sideB: { side: 2, players: [{ participantId: 'b', profileId: 'pf-b', name: 'Bob', position: 1, courseHandicap: null, holeScores: [{ hole_number: 1, strokes: 5 }] }] },
      concessions: [{ hole: 2, by_side: 2, by: 'pf-b', at: 't' }], extraHoles: [], decision: null,
    };
    const view = projectMatch({ id: 'm1', version: 3, round_id: 'r1', group: { id: 'g1', sequence: 1, name: null, starting_hole: 1, tee_time: null }, sides: [side(1, [member('a', 'Ann')]), side(2, [member('b', 'Bob')])], bye: false, input, state: computeMatch(input), stored: { decided_by: null, winner_side: null, result: null, decided_at: null } });
    expect(view).toMatchObject({ id: 'm1', version: 3, title: 'Match 1', line: 'Ann vs Bob', holes: 9, hole_order: [1, 2, 3, 4, 5, 6, 7, 8, 9], concessions: [{ hole: 2, by_side: 2 }], extra_holes: [], state: { status: 'live', up: 2, thru: 2, summary: 'Ann 2 UP thru 2' } });
    expect(JSON.stringify(view)).not.toContain('holeScores');
    expect(sideOfViewer(view, 'pf-b')).toBe(2);
    expect(sideOfViewer(view, 'pf-a')).toBe(1);
    expect(sideOfViewer(view, 'pf-x')).toBeNull();
    expect(sideOfViewer(view, null)).toBeNull();
  });
});
