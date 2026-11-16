import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dayRangeLabel,
  historyScopeSearch,
  parseHistoryScope,
  scopeTrail,
  timelineDays,
  timelineMonths,
  timelineTotals,
  timelineWeeks,
  timelineYears,
  totalTimeLabel,
  weekKeyOf,
  weekRange,
  weekSessions,
  type TimelineSession,
} from '../training/timeline';

// Training's timeline ("one wave", phase 2, Nov 2026): Year → Month → Week → Session,
// grouped in the viewer's own calendar. Instants are built from LOCAL parts, so the
// pins hold in any time zone the tests run in.
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h).toISOString();
const s = (id: string, startedAt: string, extra: Partial<TimelineSession> = {}): TimelineSession => ({ id, kind: 'workout', startedAt, seconds: 3600, distanceM: null, title: id, ...extra });

const sessions: TimelineSession[] = [
  s('dec-tue', at(2026, 12, 1), { kind: 'activity', type: 'run', distanceM: 5000, seconds: 1500, effort: 6 }),
  s('nov-mon-30', at(2026, 11, 30), { effort: 5 }), // the same WEEK as dec-tue, another month
  s('nov-sun-29', at(2026, 11, 29, 23)), // 11 pm Sunday: still that day, that week
  s('nov-9a', at(2026, 11, 9, 7)),
  s('nov-9b', at(2026, 11, 9, 18), { kind: 'activity', type: 'ride', distanceM: 20000 }),
  s('jan-1', at(2026, 1, 1)), // a Thursday: its week began Dec 29 2025
  s('dec-31-2025', at(2025, 12, 31)),
];

describe('training timeline', () => {
  it('years, newest first, each a full count', () => {
    const years = timelineYears(sessions);
    expect(years.map(y => [y.year, y.sessions])).toEqual([[2026, 6], [2025, 1]]);
    expect(years[0].activeDays).toBe(5); // two sessions on Nov 9 are one day
    expect(years[0].distanceM).toBe(25000);
  });

  it('a year\'s months add up to the year', () => {
    const months = timelineMonths(sessions, 2026);
    expect(months.map(m => [m.key, m.sessions])).toEqual([['2026-12', 1], ['2026-11', 4], ['2026-01', 1]]);
    expect(months.reduce((n, m) => n + m.sessions, 0)).toBe(timelineYears(sessions)[0].sessions);
  });

  it('a month\'s weeks count only the days inside the month, so they add up to it', () => {
    const nov = timelineWeeks(sessions, 2026, 11);
    expect(nov.map(w => [w.week, w.from, w.to, w.sessions])).toEqual([
      ['2026-11-30', '2026-11-30', '2026-11-30', 1],
      ['2026-11-23', '2026-11-23', '2026-11-29', 1],
      ['2026-11-09', '2026-11-09', '2026-11-15', 2],
    ]);
    const dec = timelineWeeks(sessions, 2026, 12);
    expect(dec.map(w => [w.week, w.from, w.to, w.sessions])).toEqual([['2026-11-30', '2026-12-01', '2026-12-06', 1]]);
    // January 1 2026 sits in the week of Monday Dec 29 2025 — shown from the 1st.
    expect(timelineWeeks(sessions, 2026, 1).map(w => [w.week, w.from, w.to])).toEqual([['2025-12-29', '2026-01-01', '2026-01-04']]);
  });

  it('a week is its seven days, whatever month or year they are in', () => {
    expect(weekSessions(sessions, '2026-11-30').map(x => x.id).sort()).toEqual(['dec-tue', 'nov-mon-30']);
    expect(weekSessions(sessions, '2025-12-29').map(x => x.id).sort()).toEqual(['dec-31-2025', 'jan-1']);
    expect(weekRange('2025-12-29')).toEqual({ from: '2025-12-29', to: '2026-01-04' });
    expect(weekKeyOf(new Date(2026, 10, 29, 23))).toBe('2026-11-23'); // Sunday belongs to the Monday before
  });

  it('days: newest day first, inside a day the order it happened', () => {
    const days = timelineDays(weekSessions(sessions, '2026-11-09'));
    expect(days).toHaveLength(1);
    expect(days[0].key).toBe('2026-11-09');
    expect(days[0].sessions.map(x => x.id)).toEqual(['nov-9a', 'nov-9b']);
    expect(timelineDays(weekSessions(sessions, '2026-11-30')).map(d => d.key)).toEqual(['2026-12-01', '2026-11-30']);
  });

  it('load is minutes × effort over the rated sessions only, and says how many', () => {
    const t = timelineTotals(weekSessions(sessions, '2026-11-30'));
    expect(t).toMatchObject({ sessions: 2, rated: 2, load: 25 * 6 + 60 * 5, seconds: 5100, distanceM: 5000, activeDays: 2 });
    expect(timelineTotals(weekSessions(sessions, '2026-11-09'))).toMatchObject({ rated: 0, load: 0 });
    expect(timelineTotals([])).toEqual({ sessions: 0, seconds: 0, activeDays: 0, distanceM: 0, load: 0, rated: 0 });
  });

  it('the address: the deepest level that reads wins; anything else is the whole History', () => {
    expect(parseHistoryScope({ year: '2026' })).toEqual({ level: 'year', year: 2026 });
    expect(parseHistoryScope({ month: '2026-11' })).toEqual({ level: 'month', year: 2026, month: 11 });
    expect(parseHistoryScope({ week: '2026-11-09' })).toEqual({ level: 'week', week: '2026-11-09' });
    expect(parseHistoryScope({ week: '2026-11-11' })).toEqual({ level: 'week', week: '2026-11-09' }); // a Wednesday is its week
    expect(parseHistoryScope({ year: '2026', month: '2026-11', week: '2026-11-09' }).level).toBe('week');
    for (const bad of [{ year: '26' }, { year: '2026; drop' }, { month: '2026-13' }, { week: '2026-02-30' }, { week: '<script>' }, {}]) {
      expect(parseHistoryScope(bad)).toEqual({ level: 'all' });
    }
    expect(historyScopeSearch({ level: 'all' })).toBe('?tab=training&view=history');
    expect(historyScopeSearch({ level: 'year', year: 2026 })).toBe('?tab=training&view=history&year=2026');
    expect(historyScopeSearch({ level: 'month', year: 2026, month: 3 })).toBe('?tab=training&view=history&month=2026-03');
    expect(historyScopeSearch({ level: 'week', week: '2026-11-09' })).toBe('?tab=training&view=history&week=2026-11-09');
  });

  it('the way up: a week → its Monday\'s month → the year → History', () => {
    expect(scopeTrail({ level: 'week', week: '2026-11-30' })).toEqual([{ level: 'all' }, { level: 'year', year: 2026 }, { level: 'month', year: 2026, month: 11 }]);
    expect(scopeTrail({ level: 'month', year: 2026, month: 11 })).toEqual([{ level: 'all' }, { level: 'year', year: 2026 }]);
    expect(scopeTrail({ level: 'all' })).toEqual([]);
  });

  it('the words', () => {
    expect(totalTimeLabel(2700)).toBe('45 min');
    expect(totalTimeLabel(5400)).toBe('1 h 30 min');
    expect(totalTimeLabel(7200)).toBe('2 h');
    expect(totalTimeLabel(96.4 * 3600)).toBe('96 h');
    expect(dayRangeLabel('2026-11-09', '2026-11-15')).toBe('Nov 9 – 15');
    expect(dayRangeLabel('2026-11-30', '2026-12-06')).toBe('Nov 30 – Dec 6');
    expect(dayRangeLabel('2026-11-30', '2026-11-30')).toBe('Nov 30');
  });

  it('the reader keeps History\'s row rules and the route its gate', () => {
    const reader = readFileSync(join(__dirname, '../training/timeline-server.ts'), 'utf8');
    expect(reader).toContain(".is('profile_hidden_at', null).not('share_decided_at', 'is', null)");
    expect(reader).toContain(".eq('only_me', false)");
    expect(reader).toContain(".eq('status', 'completed')");
    const route = readFileSync(join(__dirname, '../../app/api/profile/[profileId]/training/timeline/route.ts'), 'utf8');
    expect(route).toContain('resolveActivityAccess');
    expect(route).toContain("aspectHidden(await fetchTrainingPrivacy(admin, profileId), 'workouts', isOwner)");
    expect(route).toContain("'private, no-store'");
  });
});
