import { describe, expect, it } from 'vitest';
import { buildOrgChecklistSteps, remainingSteps } from '../checklist';

const base = { hasSeasonWithDates: false, hasDivisions: false, hasTeams: false, managerCount: 1, rosterAthleteCount: 0 };

describe('buildOrgChecklistSteps (phase 7 C5)', () => {
  it('default: the phase-1 steps, registration only when known, anchors into the console', () => {
    const steps = buildOrgChecklistSteps(base);
    expect(steps.map(s => s.key)).toEqual(['season', 'divisions', 'teams', 'managers', 'roster']);
    expect(steps[0].href).toBe('#seasons');
    expect(buildOrgChecklistSteps({ ...base, hasOpenRegistration: false }).map(s => s.key)).toContain('registration');
    expect(buildOrgChecklistSteps(base, 'default')).toEqual(steps);
  });

  it('golf: the site-builder checklist — site, photo/CTA, home course (optional), publish, members, league, notice', () => {
    const steps = buildOrgChecklistSteps(base, 'golf');
    expect(steps.map(s => s.key)).toEqual(['site', 'brand', 'course', 'publish', 'members', 'league', 'notice']);
    expect(steps.every(s => !s.done)).toBe(true);
    expect(steps.find(s => s.key === 'course')?.optional).toBe(true);
    expect(steps.find(s => s.key === 'league')?.href).toBe('#competitions');
    expect(steps.find(s => s.key === 'members')?.href).toBe('#roster');
  });

  it('golf: done derives from the console rows; a lone owner is not "members"', () => {
    const steps = buildOrgChecklistSteps(
      {
        ...base,
        hasSite: true,
        hasSitePhotoOrCta: true,
        sitePublished: true,
        memberCount: 1,
        hasGolfLeague: true,
        hasNotice: true,
      },
      'golf'
    );
    const done = Object.fromEntries(steps.map(s => [s.key, s.done]));
    expect(done).toEqual({ site: true, brand: true, course: false, publish: true, members: false, league: true, notice: true });
    expect(remainingSteps(steps).map(s => s.key)).toEqual(['members']); // the optional course never blocks
    expect(remainingSteps(buildOrgChecklistSteps({ ...base, hasSite: true, hasSitePhotoOrCta: true, sitePublished: true, memberCount: 2, hasGolfLeague: true, hasNotice: true }, 'golf'))).toEqual([]);
  });
});
