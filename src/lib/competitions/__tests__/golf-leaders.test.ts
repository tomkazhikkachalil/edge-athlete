import { describe, expect, it } from 'vitest';
import { buildGolfLeaderBoards, type GolfLeaderInputRow } from '../golf-leaders';

const row = (o: Partial<GolfLeaderInputRow> & { contestId: string; entryId: string }): GolfLeaderInputRow => ({
  contestRound: 'Week 1',
  contestPlayFrom: '2026-09-01',
  gross: null,
  net: null,
  holes: 9,
  score: null,
  ...o,
});

const names = new Map<string, string | null>([
  ['a', 'Edge A.'],
  ['b', 'Jane Doe'],
  ['kid', null], // supervised → omitted
]);

const rows: GolfLeaderInputRow[] = [
  row({ contestId: 'c1', entryId: 'a', gross: 41, net: 36, score: 36 }),
  row({ contestId: 'c1', entryId: 'b', gross: 38, net: 37, score: 37 }),
  row({ contestId: 'c1', entryId: 'kid', gross: 35, net: 30, score: 30 }),
  row({ contestId: 'c2', contestRound: 'Week 2', contestPlayFrom: '2026-09-08', entryId: 'a', gross: 39, net: 34, score: 34 }),
  row({ contestId: 'c3', contestRound: 'Week 3', contestPlayFrom: '2026-09-15', entryId: 'a', gross: 80, net: 70, holes: 18, score: 70 }),
];

describe('buildGolfLeaderBoards', () => {
  it('low gross by nine and by eighteen; net boards only under golf_net; the supervised athlete never appears', () => {
    const boards = buildGolfLeaderBoards({ rows, nameByEntry: names, scoringRule: 'golf_net' });
    const byLabel = Object.fromEntries(boards.map(b => [b.label, b]));
    expect(byLabel['Low gross (9 holes)'].rows).toEqual([
      { name: 'Jane Doe', value: 38 },
      { name: 'Edge A.', value: 39 },
    ]);
    expect(byLabel['Low gross (18 holes)'].rows).toEqual([{ name: 'Edge A.', value: 80 }]);
    expect(byLabel['Low net (9 holes)'].rows).toEqual([
      { name: 'Edge A.', value: 34 },
      { name: 'Jane Doe', value: 37 },
    ]);
    expect(byLabel['Low net (9 holes)'].valueLabel).toBe('Net');
    expect(JSON.stringify(boards)).not.toContain('kid');
    const gross = buildGolfLeaderBoards({ rows, nameByEntry: names, scoringRule: 'golf_gross' });
    expect(gross.some(b => b.label.startsWith('Low net'))).toBe(false);
  });
  it('most rounds counts distinct rounds; best week is the lowest single-round rule score with its round as the note', () => {
    const boards = buildGolfLeaderBoards({ rows, nameByEntry: names, scoringRule: 'golf_net' });
    const byLabel = Object.fromEntries(boards.map(b => [b.label, b]));
    expect(byLabel['Most rounds'].rows).toEqual([
      { name: 'Edge A.', value: 3 },
      { name: 'Jane Doe', value: 1 },
    ]);
    expect(byLabel['Most rounds'].valueLabel).toBe('Rounds');
    expect(byLabel['Best week'].rows[0]).toEqual({ name: 'Edge A.', value: 34, note: 'Week 2 · 2026-09-08' });
    expect(byLabel['Best week'].valueLabel).toBe('Net');
  });
  it('ties break by name; top N holds; nothing in → nothing out', () => {
    const tie = [
      row({ contestId: 'c1', entryId: 'b', gross: 40, score: 40 }),
      row({ contestId: 'c1', entryId: 'a', gross: 40, score: 40 }),
    ];
    const boards = buildGolfLeaderBoards({ rows: tie, nameByEntry: names, scoringRule: 'golf_gross', top: 1 });
    expect(boards[0].rows).toEqual([{ name: 'Edge A.', value: 40 }]);
    expect(buildGolfLeaderBoards({ rows: [], nameByEntry: names, scoringRule: 'golf_gross' })).toEqual([]);
    expect(buildGolfLeaderBoards({ rows: [rows[2]], nameByEntry: names, scoringRule: 'golf_gross' })).toEqual([]);
  });
});
