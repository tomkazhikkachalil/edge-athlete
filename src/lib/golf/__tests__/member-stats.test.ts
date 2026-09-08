import { describe, expect, it } from 'vitest';
import { buildMemberStats, EMPTY_MEMBER_STATS, type MemberStatsRound } from '../member-stats';

const people = [
  { profileId: 'a', name: 'Ann Able', handle: 'ann', handicap: '12.4' },
  { profileId: 'b', name: 'Bo B.', handle: null, handicap: null },
  { profileId: 'c', name: 'Cy Cole', handle: 'cy', handicap: null },
];
const r = (id: string, profileId: string, date: string, holes: number, gross: number, courseName = 'Any'): MemberStatsRound => ({
  id, profileId, date, holes, gross, createdAt: `${date}T12:00:00Z`, courseName,
});

describe('buildMemberStats', () => {
  it('lists every member — with zero rounds too — most active first', () => {
    const out = buildMemberStats({
      people,
      rounds: [r('1', 'a', '2026-09-01', 18, 88), r('2', 'a', '2026-08-20', 18, 84), r('3', 'b', '2026-09-03', 9, 41)],
      seasonFrom: '2026-01-01',
    });
    expect(out.memberCount).toBe(3);
    expect(out.roundsPosted).toBe(3);
    expect(out.members.map(m => m.name)).toEqual(['Ann Able', 'Bo B.', 'Cy Cole']);
    expect(out.members[0]).toMatchObject({ rounds: 2, roundsThisSeason: 2, avg18: 86, best18: { gross: 84, date: '2026-08-20' }, avg9: null, best9: null, handicap: '12.4' });
    expect(out.members[1]).toMatchObject({ rounds: 1, avg9: 41, best9: { gross: 41, date: '2026-09-03' }, avg18: null, handle: null });
    expect(out.members[2]).toMatchObject({ rounds: 0, roundsThisSeason: 0, avg18: null, best18: null });
  });

  it('nine and eighteen never compete; averages need three rounds; a masked name never links', () => {
    const out = buildMemberStats({
      people,
      rounds: [
        r('1', 'a', '2026-09-01', 18, 88), r('2', 'a', '2026-08-20', 18, 84), r('3', 'a', '2026-08-10', 18, 90),
        r('4', 'b', '2026-09-03', 9, 41), r('5', 'b', '2026-09-04', 9, 39),
      ],
      seasonFrom: '2026-01-01',
    });
    const labels = out.boards.map(b => b.label);
    expect(labels).toEqual(['Low round (18)', 'Low round (9)', 'Scoring average (18)', 'Most rounds this season']);
    expect(out.boards[0].rows[0]).toEqual({ name: 'Ann Able', value: 84, note: '2026-08-20', playerHandle: 'ann' });
    expect(out.boards[1].rows[0]).toEqual({ name: 'Bo B.', value: 39, note: '2026-09-04' }); // masked: no handle
    expect(out.boards[2].rows[0]).toMatchObject({ name: 'Ann Able', value: 87.3 });
    expect(labels).not.toContain('Scoring average (9)'); // Bo has only two 9-hole rounds
    expect(out.boards[3].rows.map(x => [x.name, x.value])).toEqual([['Ann Able', 3], ['Bo B.', 2]]);
  });

  it('this-season counts respect seasonFrom; recent is newest first; junk rounds are dropped', () => {
    const out = buildMemberStats({
      people,
      rounds: [r('1', 'a', '2025-12-30', 18, 80), r('2', 'a', '2026-02-01', 18, 82), r('3', 'c', '2026-03-01', 12, 60), r('4', 'c', '2026-03-02', 18, 0)],
      seasonFrom: '2026-01-01',
      recent: 2,
    });
    expect(out.members.find(m => m.profileId === 'a')).toMatchObject({ rounds: 2, roundsThisSeason: 1, best18: { gross: 80, date: '2025-12-30' } });
    expect(out.members.find(m => m.profileId === 'c')).toMatchObject({ rounds: 0 });
    expect(out.recent.map(x => x.date)).toEqual(['2026-02-01', '2025-12-30']);
  });

  it('no people → the empty shape', () => {
    expect(buildMemberStats({ people: [], rounds: [], seasonFrom: '2026-01-01' })).toEqual(EMPTY_MEMBER_STATS);
  });
});
