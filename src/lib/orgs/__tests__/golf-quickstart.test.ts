import { describe, expect, it } from 'vitest';
import { quickstartPlan } from '../golf-quickstart-server';
import { defaultSeasonLabel } from '../default-season';

const today = new Date('2026-09-08T15:00:00Z');

describe('defaultSeasonLabel', () => {
  it('is the calendar year, UTC', () => {
    expect(defaultSeasonLabel(today)).toBe('2026');
    expect(defaultSeasonLabel(new Date('2026-12-31T23:30:00Z'))).toBe('2026');
    expect(defaultSeasonLabel(new Date('2027-01-01T00:30:00Z'))).toBe('2027');
  });
});

describe('quickstartPlan', () => {
  it('names the league after the year, starts today, and lays out weekly windows', () => {
    const plan = quickstartPlan({ today, holes: 18, weeks: 4, windowDays: 7 });
    expect(plan.seasonLabel).toBe('2026');
    expect(plan.competitionName).toBe('2026 League');
    expect(plan.startDate).toBe('2026-09-08');
    expect(plan.windows).toHaveLength(4);
    expect(plan.windows[0]).toMatchObject({ round: 'Week 1', playFrom: '2026-09-08', playTo: '2026-09-14', holes: 18 });
    expect(plan.windows[3]).toMatchObject({ round: 'Week 4', playFrom: '2026-09-29', playTo: '2026-10-05' });
  });
  it('honours an explicit start date and a 9-hole league with a short window', () => {
    const plan = quickstartPlan({ today, holes: 9, weeks: 2, windowDays: 3, startDate: '2026-10-01' });
    expect(plan.windows.map(w => [w.playFrom, w.playTo, w.holes])).toEqual([
      ['2026-10-01', '2026-10-03', 9],
      ['2026-10-08', '2026-10-10', 9],
    ]);
  });
});
