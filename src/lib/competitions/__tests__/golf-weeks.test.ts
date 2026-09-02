import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  buildGolfBlock,
  formatDateRange,
  formatIsoDate,
  publicResultFromRow,
  selectCurrentWeek,
  sortWeeks,
  weekState,
  type GolfResultRaw,
} from '../golf-weeks';

describe('addDaysIso — date-only arithmetic', () => {
  it('rolls over month and year ends', () => {
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2027-01-01', -1)).toBe('2026-12-31');
  });
  it('knows leap days', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
  });
  it('is DST-free (a spring-forward Sunday is still one day)', () => {
    expect(addDaysIso('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDaysIso('2026-03-08', 1)).toBe('2026-03-09');
  });
  it('returns junk unchanged rather than throwing', () => {
    expect(addDaysIso('not-a-date', 3)).toBe('not-a-date');
  });
});

describe('weekState + selectCurrentWeek', () => {
  const weeks = [
    { id: 'w1', round: 'Week 1', playFrom: '2026-09-01', playTo: '2026-09-07' },
    { id: 'w2', round: 'Week 2', playFrom: '2026-09-08', playTo: '2026-09-14' },
    { id: 'w3', round: 'Week 3', playFrom: '2026-09-15', playTo: '2026-09-21' },
  ];
  it('both window ends are inclusive', () => {
    expect(weekState(weeks[0], '2026-09-01')).toBe('open');
    expect(weekState(weeks[0], '2026-09-07')).toBe('open');
    expect(weekState(weeks[0], '2026-08-31')).toBe('upcoming');
    expect(weekState(weeks[0], '2026-09-08')).toBe('closed');
  });
  it('leads with the containing window', () => {
    expect(selectCurrentWeek(weeks, '2026-09-10')).toBe('w2');
  });
  it('else the next to open', () => {
    expect(selectCurrentWeek(weeks, '2026-08-01')).toBe('w1');
    // A gap between windows: the next one, not the last closed one.
    expect(selectCurrentWeek([weeks[0], weeks[2]], '2026-09-10')).toBe('w3');
  });
  it('else the most recently closed', () => {
    expect(selectCurrentWeek(weeks, '2026-10-01')).toBe('w3');
  });
  it('null for no weeks', () => {
    expect(selectCurrentWeek([], '2026-09-10')).toBeNull();
  });
  it('sortWeeks is chronological then label then id', () => {
    const shuffled = [weeks[2], { ...weeks[0], id: 'w1b', round: 'Week 1b' }, weeks[1], weeks[0]];
    expect(sortWeeks(shuffled).map(w => w.id)).toEqual(['w1', 'w1b', 'w2', 'w3']);
  });
});

describe('formatDateRange / formatIsoDate — no Intl', () => {
  it('same month', () => expect(formatDateRange('2026-09-01', '2026-09-07')).toBe('Sep 1 – 7'));
  it('cross month', () => expect(formatDateRange('2026-09-28', '2026-10-04')).toBe('Sep 28 – Oct 4'));
  it('cross year', () =>
    expect(formatDateRange('2026-12-29', '2027-01-04')).toBe('Dec 29, 2026 – Jan 4, 2027'));
  it('single day', () => expect(formatDateRange('2026-09-01', '2026-09-01')).toBe('Sep 1'));
  it('one date', () => expect(formatIsoDate('2026-09-07')).toBe('Sep 7'));
});

describe('publicResultFromRow', () => {
  const base: GolfResultRaw = {
    contest_id: 'c',
    participant_id: 'p',
    score: 36,
    payload: { gross: 41, net: 36, holes: 9, tee: 'white' },
    provenance: 'self_reported',
    dispute_status: null,
  };
  it('a synced result carries gross, net, holes, tee and reads "posted"', () => {
    expect(publicResultFromRow(base, 'Edge A.', 'golf_net')).toEqual({
      entrant_name: 'Edge A.',
      gross: 41,
      net: 36,
      holes: 9,
      tee: 'white',
      status: 'posted',
      disputed: false,
    });
  });
  it('confirmed and organizer-entered results read "final"', () => {
    expect(publicResultFromRow({ ...base, provenance: 'league_verified' }, 'A', 'golf_net').status).toBe('final');
    expect(publicResultFromRow({ ...base, provenance: 'owner' }, 'A', 'golf_net').status).toBe('final');
  });
  it('an organizer-typed score ({} payload) lands in the rule column only', () => {
    const typed = { ...base, payload: {}, score: 39, provenance: 'owner' };
    expect(publicResultFromRow(typed, 'A', 'golf_net')).toMatchObject({ gross: null, net: 39 });
    expect(publicResultFromRow(typed, 'A', 'golf_gross')).toMatchObject({ gross: 39, net: null });
  });
  it('disputed rides along', () => {
    expect(publicResultFromRow({ ...base, dispute_status: 'disputed' }, 'A', 'golf_gross').disputed).toBe(true);
  });
});

describe('buildGolfBlock', () => {
  const contests = [
    { id: 'c2', round: 'Week 2', status: 'scheduled', venue_id: 'v', holes: 9, play_from: '2026-09-08', play_to: '2026-09-14' },
    { id: 'c1', round: 'Week 1', status: 'completed', venue_id: 'v', holes: 9, play_from: '2026-09-01', play_to: '2026-09-07' },
    { id: 'legacy', round: 'Club champs', status: 'scheduled', venue_id: null, holes: null as unknown as number, play_from: '', play_to: '' },
  ];
  const participants = [
    { id: 'p1a', contest_id: 'c1', entry_id: 'ea' },
    { id: 'p1b', contest_id: 'c1', entry_id: 'eb' },
    { id: 'p1k', contest_id: 'c1', entry_id: 'ekid' },
    { id: 'p2a', contest_id: 'c2', entry_id: 'ea' },
    { id: 'p2b', contest_id: 'c2', entry_id: 'eb' },
    { id: 'p2k', contest_id: 'c2', entry_id: 'ekid' },
  ];
  const results: GolfResultRaw[] = [
    { contest_id: 'c1', participant_id: 'p1a', score: 41, payload: { gross: 41, holes: 9, tee: 'white' }, provenance: 'league_verified', dispute_status: null },
    { contest_id: 'c1', participant_id: 'p1b', score: 38, payload: { gross: 38, holes: 9, tee: 'white' }, provenance: 'league_verified', dispute_status: null },
    { contest_id: 'c1', participant_id: 'p1k', score: 35, payload: { gross: 35, holes: 9, tee: 'white' }, provenance: 'league_verified', dispute_status: null },
    { contest_id: 'c2', participant_id: 'p2b', score: 40, payload: { gross: 40, holes: 9, tee: 'white' }, provenance: 'self_reported', dispute_status: null },
  ];
  const input = {
    contests,
    participants,
    results,
    entryName: new Map([
      ['ea', 'Edge Alpha'],
      ['eb', 'Edge B.'],
      ['ekid', 'Casey Minor'],
    ]),
    omittedEntries: new Set(['ekid']),
    courseNameByVenue: new Map([['v', 'QA Nine']]),
    pick: 'first' as const,
    scoringRule: 'golf_gross',
    today: '2026-09-10',
  };

  it('drops windowless contests, sorts weeks, leads with the open one', () => {
    const block = buildGolfBlock(input)!;
    expect(block.weeks.map(w => w.id)).toEqual(['c1', 'c2']);
    expect(block.currentWeekId).toBe('c2');
    expect(block.weeks[1].state).toBe('open');
    expect(block.weeks[0].state).toBe('closed');
    expect(block.weeks[0].courseName).toBe('QA Nine');
  });
  it('omits supervised athletes from results but counts them as posted', () => {
    const block = buildGolfBlock(input)!;
    const w1 = block.weeks[0];
    expect(w1.participants).toBe(3);
    expect(w1.posted).toBe(3);
    expect(w1.results.map(r => r.entrant_name)).toEqual(['Edge B.', 'Edge Alpha']);
    expect(JSON.stringify(block)).not.toContain('Casey');
  });
  it('orders results fewest strokes first with status per provenance', () => {
    const block = buildGolfBlock(input)!;
    expect(block.weeks[0].results.map(r => [r.gross, r.status])).toEqual([
      [38, 'final'],
      [41, 'final'],
    ]);
    expect(block.weeks[1].results).toEqual([
      { entrant_name: 'Edge B.', gross: 40, net: null, holes: 9, tee: 'white', status: 'posted', disputed: false },
    ]);
  });
  it('is null when no contest has a window (legacy leaderboards stay untouched)', () => {
    expect(buildGolfBlock({ ...input, contests: [contests[2]] })).toBeNull();
  });
  it('skips canceled rounds', () => {
    const block = buildGolfBlock({ ...input, contests: [{ ...contests[1], status: 'canceled' }, contests[0]] })!;
    expect(block.weeks.map(w => w.id)).toEqual(['c2']);
  });
});
