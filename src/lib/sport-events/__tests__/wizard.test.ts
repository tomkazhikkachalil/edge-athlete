import { describe, expect, it } from 'vitest';
import { emptyWizardState, isWizardDirty, validateWizardStep, wizardCourseFrom, wizardToCreateBody, type WizardState } from '../wizard';

const filled = (): WizardState => ({ ...emptyWizardState(), name: 'Spring Open', scheduled_on: '2030-06-01', course: { id: null, name: 'Eagle Creek', tees: [], holesCount: null }, holes: 9, starting_hole: 10, format: 'stroke_net', capacity: '8' });

describe('the wizard rules', () => {
  it('validates each step with the copy the user reads', () => {
    const s = emptyWizardState();
    expect(validateWizardStep('basics', s)).toBe('Give the event a name.');
    expect(validateWizardStep('basics', { ...s, name: 'x'.repeat(121) })).toContain('120');
    expect(validateWizardStep('round', { ...s, name: 'Open' })).toBe('Pick the date.');
    expect(validateWizardStep('round', { ...s, scheduled_on: '2030-06-01' })).toBe('Pick a course, or type its name.');
    expect(validateWizardStep('round', { ...filled(), holes: 18, starting_hole: 10 })).toBe('An 18-hole round starts on hole 1.');
    expect(validateWizardStep('format', { ...filled(), capacity: '0' })).toContain('Field size');
    expect(validateWizardStep('format', { ...filled(), capacity: '' })).toBeNull();
    expect(validateWizardStep('review', filled())).toBeNull();
    expect(validateWizardStep('review', { ...filled(), name: '' })).toBe('Give the event a name.');
  });
  it('dirty means anything typed or picked', () => {
    expect(isWizardDirty(emptyWizardState())).toBe(false);
    expect(isWizardDirty({ ...emptyWizardState(), name: 'x' })).toBe(true);
    expect(isWizardDirty({ ...emptyWizardState(), holes: 9 })).toBe(true);
  });
  it('the body is the create route\'s shape; a nine keeps its start, an eighteen starts on 1; blanks become null', () => {
    expect(wizardToCreateBody(filled(), { publish: true, profileId: null })).toEqual({
      name: 'Spring Open', description: null, sport_key: 'golf', visibility: 'private', join_mode: 'invite', format: 'stroke_net', capacity: 8, club_id: null, league_id: null, host_plays: true, publish: true, profile_id: null,
      round: { scheduled_on: '2030-06-01', course_id: null, course_name: 'Eagle Creek', tee: null, holes: 9, starting_hole: 10 },
    });
    const body = wizardToCreateBody({ ...filled(), holes: 18, org: { kind: 'club', id: 'c1' }, tee: ' Blue ' }, { publish: false, profileId: 'child' });
    expect(body).toMatchObject({ club_id: 'c1', league_id: null, publish: false, profile_id: 'child', round: { starting_hole: 1, tee: 'Blue' } });
  });
  it('a catalog course brings its tees from the ratings, else the yardages', () => {
    expect(wizardCourseFrom({ id: 'c', name: 'Eagle', courseRating: { Blue: 71.5, White: 69.9 }, slopeRating: { Blue: 128 }, holesCount: 18 })).toEqual({ id: 'c', name: 'Eagle', tees: ['Blue', 'White'], holesCount: 18 });
    expect(wizardCourseFrom({ id: 'c', name: 'Nine', holes: [{ number: 1, par: 4, yardage: { red: 300 }, handicap: 1 }] })).toEqual({ id: 'c', name: 'Nine', tees: ['red'], holesCount: 1 });
  });
});
