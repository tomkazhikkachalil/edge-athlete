import { describe, it, expect } from 'vitest';
import { GAME_SHEETS } from '../game-sheets';
import { cellText, deriveGame, nextHighWater, personKey, revealAt, revealMs, setWinner, tagsForPerson, type GameTag, type TagPerson } from '../game-derive';

/**
 * Every stat of a tagged game comes from its tags (Sprint 3, Nov 12 2026):
 * tag a bucket and the points go up; delete the tag and they come back down.
 */
let seq = 0;
const who = (role: string, id: string | null, name: string | null = null): TagPerson => ({ role, profileId: id, name });
const tag = (ms: number, eventKey: string | null, side: 1 | 2 | null, people: TagPerson[] = [], more: Partial<GameTag> = {}): GameTag => ({
  id: `t${String(++seq).padStart(4, '0')}`, startMs: ms, endMs: null, eventKey, period: 1, side, value: null, label: '', people, ...more,
});

describe('basketball', () => {
  const sheet = GAME_SHEETS.basketball;
  const tags = [
    tag(10_000, 'fg3_made', 1, [who('scorer', 'ann'), who('assist', 'bea')]),
    tag(20_000, 'fg2_made', 2, [who('scorer', 'cy')]),
    tag(30_000, 'ft_made', 1, [who('scorer', 'ann')]),
    tag(40_000, 'fg2_missed', 1, [who('shooter', 'ann')]),
    tag(50_000, 'rebound_def', 2, [who('player', 'cy')]),
    tag(60_000, 'fg2_made', 1, [], { period: 2 }), // nobody named: still the team's
    tag(70_000, null, 1, [who('scorer', 'ann')]), // a plain marker: a clip, not a stat
  ];
  const g = deriveGame(sheet, tags);
  it('the score is the tags', () => {
    expect(g.score).toEqual({ 1: 6, 2: 2 });
    expect(g.periods).toEqual([{ period: 1, score: { 1: 4, 2: 2 } }, { period: 2, score: { 1: 2, 2: 0 } }]);
  });
  it('a made three is three points, a field goal and a three; the assist is the passer\'s', () => {
    const ann = g.players.find(p => p.key === 'p:ann')!;
    expect(ann.stats).toEqual({ points: 4, fgm: 1, fga: 2, threes: 1, tpa: 1, ftm: 1, fta: 1 });
    expect(g.players.find(p => p.key === 'p:bea')!.stats).toEqual({ assists: 1 });
    expect(cellText(ann.stats, ['fgm', 'fga'])).toBe('1-2');
    expect(cellText(ann.stats, 'rebounds')).toBe('0');
  });
  it('team totals include a tag with nobody named; the box does not invent a player for it', () => {
    expect(g.team[1]).toMatchObject({ points: 6, fgm: 2, fga: 3 });
    expect(g.team[2]).toMatchObject({ points: 2, rebounds: 1, dreb: 1 });
    expect(g.players.map(p => p.key).sort()).toEqual(['p:ann', 'p:bea', 'p:cy']);
  });
  it('the scoring summary is in order with the running score', () => {
    expect(g.summary.map(s => [s.eventKey, s.side, s.score[1], s.score[2]])).toEqual([['fg3_made', 1, 3, 0], ['fg2_made', 2, 3, 2], ['ft_made', 1, 4, 2], ['fg2_made', 1, 6, 2]]);
  });
  it('a plain marker counts for nothing but is still the athlete\'s clip', () => {
    expect(g.tagIds).not.toContain(tags[6].id);
    expect(tagsForPerson(sheet, tags, 'p:ann').map(t => t.id)).toContain(tags[6].id);
  });
  it('deleting a tag takes its points back', () => {
    expect(deriveGame(sheet, tags.slice(1)).score).toEqual({ 1: 3, 2: 2 });
  });
});

describe('the spoiler-free cut', () => {
  const sheet = GAME_SHEETS.basketball;
  const tags = [tag(10_000, 'fg2_made', 1, [who('scorer', 'ann')]), tag(90_000, 'fg3_made', 2, [who('scorer', 'cy')])];
  it('nothing before the first tag, each tag as the playhead passes it, everything at the end', () => {
    expect(revealAt(sheet, tags, 9_999).score).toEqual({ 1: 0, 2: 0 });
    expect(revealAt(sheet, tags, 9_999).players).toEqual([]);
    expect(revealAt(sheet, tags, 10_000).score).toEqual({ 1: 2, 2: 0 });
    expect(revealAt(sheet, tags, 89_000).summary).toHaveLength(1);
    expect(revealAt(sheet, tags, 90_000).score).toEqual({ 1: 2, 2: 3 });
  });
  it('a clip with a lead-in reveals at its END — the build-up to a basket never shows the basket', () => {
    const clip = [tag(22_000, 'fg3_made', 1, [who('scorer', 'ann')], { endMs: 34_000 })];
    expect(revealMs(clip[0])).toBe(34_000);
    expect(revealAt(sheet, clip, 30_000).score).toEqual({ 1: 0, 2: 0 });
    expect(revealAt(sheet, clip, 34_000).score).toEqual({ 1: 3, 2: 0 });
    expect(revealMs({ startMs: 10, endMs: null })).toBe(10);
  });
  it('the furthest point watched only moves forward', () => {
    expect(nextHighWater(null, 30_000)).toBe(30_000);
    expect(nextHighWater(30_000, 90_000)).toBe(90_000); // skipped ahead: revealed up to there
    expect(nextHighWater(90_000, 5_000)).toBe(90_000); // skipped back: nothing hides
    expect(nextHighWater(90_000, Number.NaN)).toBe(90_000);
    expect(nextHighWater(undefined, -5)).toBe(0);
  });
});

describe('soccer', () => {
  const sheet = GAME_SHEETS.soccer;
  const g = deriveGame(sheet, [
    tag(1, 'goal', 1, [who('scorer', 'ann'), who('assist', 'bea')]),
    tag(2, 'own_goal', 1, [who('player', 'bea')]),
    tag(3, 'corner', 2),
    tag(4, 'save', 2, [who('keeper', null, 'Dee Keeper')]),
    tag(5, 'yellow_card', 2, [who('player', 'cy')]),
  ]);
  it('an own goal scores for the other side and is no goal on the player\'s line', () => {
    expect(g.score).toEqual({ 1: 1, 2: 1 });
    expect(g.players.find(p => p.key === 'p:bea')!.stats).toEqual({ assists: 1, own_goals: 1 });
    expect(g.summary[1]).toMatchObject({ eventKey: 'own_goal', side: 2 });
  });
  it('team-only numbers and a typed name', () => {
    expect(g.team[2]).toMatchObject({ corners: 1, saves: 1, yellow_cards: 1 });
    expect(g.players.find(p => p.key === 'n:dee keeper')).toMatchObject({ profileId: null, name: 'Dee Keeper', side: 2, stats: { saves: 1 } });
  });
});

describe('hockey', () => {
  const sheet = GAME_SHEETS.ice_hockey;
  const g = deriveGame(sheet, [
    tag(1, 'goal_pp', 1, [who('scorer', 'a'), who('assist', 'b'), who('assist', 'c'), who('assist', 'd'), who('goalie', 'z')]),
    tag(2, 'penalty', 2, [who('player', 'y')], { value: 5 }),
    tag(3, 'penalty', 2, [who('player', 'y')]),
  ]);
  it('two assists at most; the beaten goalie is the other side\'s; a power-play goal is the team\'s', () => {
    expect(g.players.filter(p => p.stats.assists).map(p => p.key).sort()).toEqual(['p:b', 'p:c']);
    expect(g.players.find(p => p.key === 'p:z')).toMatchObject({ side: 2, stats: { goals_against: 1 } });
    expect(g.team[1]).toMatchObject({ goals: 1, shots: 1, assists: 2, pp_goals: 1 });
  });
  it('a penalty adds its minutes — the typed value, or the default two', () => {
    expect(g.players.find(p => p.key === 'p:y')!.stats).toEqual({ pim: 7 });
  });
});

describe('volleyball — sets', () => {
  const sheet = GAME_SHEETS.volleyball;
  const rally = (n: number, key: string, side: 1 | 2, period: number) => Array.from({ length: n }, (_, i) => tag(period * 100_000 + i, key, side, [], { period }));
  it('a set is won at 25 by two (the fifth at 15); the board is sets, the periods are points', () => {
    const g = deriveGame(sheet, [...rally(25, 'kill', 1, 1), ...rally(20, 'ace', 2, 1), ...rally(24, 'kill', 1, 2), ...rally(25, 'kill', 2, 2), ...rally(3, 'service_error', 1, 2)]);
    expect(g.periods[0].score).toEqual({ 1: 25, 2: 20 });
    expect(g.periods[1].score).toEqual({ 1: 24, 2: 28 });
    expect(g.score).toEqual({ 1: 1, 2: 1 });
    expect(setWinner(sheet, 1, { 1: 25, 2: 24 })).toBeNull();
    expect(setWinner(sheet, 5, { 1: 15, 2: 13 })).toBe(1);
    expect(setWinner(sheet, 5, { 1: 14, 2: 10 })).toBeNull();
  });
  it('an attack error is the opponent\'s point and the attacker\'s error', () => {
    const g = deriveGame(sheet, [tag(1, 'attack_error', 1, [who('attacker', 'a')])]);
    expect(g.periods[0].score).toEqual({ 1: 0, 2: 1 });
    expect(g.players[0].stats).toEqual({ attack_errors: 1, attack_attempts: 1 });
  });
});

describe('baseball', () => {
  it('a home run is a run; a runner batted in is the batter\'s RBI; a strikeout is the pitcher\'s too', () => {
    const g = deriveGame(GAME_SHEETS.baseball, [
      tag(1, 'home_run', 1, [who('batter', 'a')]),
      tag(2, 'run', 1, [who('runner', 'b'), who('rbi', 'a')]),
      tag(3, 'strikeout', 1, [who('batter', 'b'), who('pitcher', 'p')]),
    ]);
    expect(g.score).toEqual({ 1: 2, 2: 0 });
    expect(g.players.find(p => p.key === 'p:a')!.stats).toMatchObject({ hits: 1, home_runs: 1, runs: 1, rbis: 2 });
    expect(g.players.find(p => p.key === 'p:p')).toMatchObject({ side: 2, stats: { strikeouts: 1 } });
  });
});

describe('combat', () => {
  it('wrestling scores its points (a takedown\'s value, a penalty to the other wrestler) and the first finish is the result', () => {
    const g = deriveGame(GAME_SHEETS.wrestling, [
      tag(1, 'takedown', 1, [who('fighter', 'a')]),
      tag(2, 'escape', 2, [who('fighter', 'b')]),
      tag(3, 'near_fall', 1, [who('fighter', 'a')], { value: 4 }),
      tag(4, 'penalty_point', 2, [who('fighter', 'b')]),
      tag(5, 'pin', 1, [who('fighter', 'a')], { period: 2 }),
      tag(6, 'decision', 2, [who('fighter', 'b')], { period: 3 }),
    ]);
    expect(g.score).toEqual({ 1: 8, 2: 1 });
    expect(g.players.find(p => p.key === 'p:a')!.stats).toEqual({ takedowns: 1, near_fall_points: 4 });
    expect(g.result).toMatchObject({ winner: 1, method: 'Pin', period: 2 });
  });
  it('MMA has no board; a defended takedown is an attempt for the other fighter', () => {
    const g = deriveGame(GAME_SHEETS.mma, [tag(1, 'takedown_stuffed', 1, [who('fighter', 'a'), who('attacker', 'b')]), tag(2, 'submission', 2, [who('fighter', 'b')], { period: 3 })]);
    expect(g.score).toEqual({ 1: 0, 2: 0 });
    expect(g.summary).toEqual([]);
    expect(g.players.find(p => p.key === 'p:b')).toMatchObject({ side: 2, stats: { takedown_attempts: 1 } });
    expect(g.result).toMatchObject({ winner: 2, method: 'Submission' });
  });
  it('BJJ: positions score 2 / 3 / 4', () => {
    const g = deriveGame(GAME_SHEETS.bjj, [tag(1, 'sweep', 1, [who('fighter', 'a')]), tag(2, 'guard_pass', 1, [who('fighter', 'a')]), tag(3, 'mount', 1, [who('fighter', 'a')])]);
    expect(g.score).toEqual({ 1: 9, 2: 0 });
    expect(g.players[0].stats).toEqual({ points: 9, sweeps: 1, passes: 1 });
  });
});

describe('races and golf', () => {
  it('finishes are fastest first within the event they were tagged under; a field mark is best first', () => {
    const sheet = GAME_SHEETS.track_field;
    const g = deriveGame(sheet, [
      tag(1, 'start', null, [], { label: '100 m final' }),
      tag(2, 'finish', null, [who('athlete', 'slow')], { value: 11_900 }),
      tag(3, 'finish', null, [who('athlete', 'fast')], { value: 10_800 }),
      tag(4, 'start', null, [], { label: 'Long jump' }),
      tag(5, 'attempt', null, [who('athlete', 'fast')], { value: 612 }),
      tag(6, 'attempt', null, [who('athlete', 'slow')], { value: 655 }),
    ]);
    expect(g.results.map(r => [r.event, r.key, r.timeMs, r.mark])).toEqual([
      ['100 m final', 'p:fast', 10_800, null], ['100 m final', 'p:slow', 11_900, null], ['Long jump', 'p:slow', null, 655], ['Long jump', 'p:fast', null, 612],
    ]);
    expect(g.score).toEqual({ 1: 0, 2: 0 });
  });
  it('golf: strokes by hole per golfer', () => {
    const g = deriveGame(GAME_SHEETS.golf, [tag(2, 'hole_score', null, [who('golfer', 'a')], { period: 2, value: 5 }), tag(1, 'hole_score', null, [who('golfer', 'a')], { period: 1, value: 4 }), tag(3, 'putt', null, [who('golfer', 'a')], { period: 2 })]);
    expect(g.holes.map(h => [h.hole, h.strokes])).toEqual([[1, 4], [2, 5]]);
  });
});

describe('people and the drill-down', () => {
  it('one key per person: a profile, or a name whatever its case; nobody = null', () => {
    expect(personKey({ profileId: 'x', name: 'Ann' })).toBe('p:x');
    expect(personKey({ profileId: null, name: '  Ann Lee ' })).toBe('n:ann lee');
    expect(personKey({ profileId: null, name: '  ' })).toBeNull();
  });
  it('an athlete\'s tags narrow by event type, by period, and to the scoring plays', () => {
    const sheet = GAME_SHEETS.basketball;
    const tags = [
      tag(1, 'fg2_made', 1, [who('scorer', 'a')], { period: 1 }),
      tag(2, 'steal', 1, [who('player', 'a')], { period: 1 }),
      tag(3, 'fg3_made', 1, [who('scorer', 'a')], { period: 3 }),
      tag(4, 'fg2_made', 1, [who('scorer', 'b'), who('assist', 'a')], { period: 4 }),
      tag(5, 'fg2_made', 2, [who('scorer', 'c')], { period: 4 }),
    ];
    expect(tagsForPerson(sheet, tags, 'p:a')).toHaveLength(4);
    expect(tagsForPerson(sheet, tags, 'p:a', { scoringOnly: true }).map(t => t.eventKey)).toEqual(['fg2_made', 'fg3_made', 'fg2_made']);
    expect(tagsForPerson(sheet, tags, 'p:a', { periods: [3, 4] })).toHaveLength(2);
    expect(tagsForPerson(sheet, tags, 'p:a', { eventKeys: ['steal'] })).toHaveLength(1);
  });
  it('someone tagged in a role the sheet does not name gets the clip and no stat', () => {
    const g = deriveGame(GAME_SHEETS.basketball, [tag(1, 'fg2_made', 1, [who('scorer', 'a'), who('screener', 'b')])]);
    expect(g.players.find(p => p.key === 'p:b')).toMatchObject({ stats: {}, tagIds: [expect.any(String)] });
    expect(g.team[1].points).toBe(2);
  });
});
