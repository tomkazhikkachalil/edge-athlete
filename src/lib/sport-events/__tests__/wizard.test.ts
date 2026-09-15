import { describe, expect, it } from 'vitest';
import { addWizardRound, emptyRoundDraft, emptyWizardState, isWizardDirty, removeWizardRound, updateWizardRound, validateWizardRounds, validateWizardStep, wizardCourseFrom, wizardToCreateBody, type RoundDraft, type WizardState } from '../wizard';

const round1: RoundDraft = { scheduled_on: '2030-06-01', course: { id: null, name: 'Eagle Creek', tees: [], holesCount: null }, tee: '', holes: 9, starting_hole: 10 };
const filled = (): WizardState => ({ ...emptyWizardState(), name: 'Spring Open', rounds: [round1], format: 'stroke_net', capacity: '8' });

describe('the wizard rules', () => {
  it('validates each step with the copy the user reads', () => {
    const s = emptyWizardState();
    expect(validateWizardStep('basics', s)).toBe('Give the event a name.');
    expect(validateWizardStep('basics', { ...s, name: 'x'.repeat(121) })).toContain('120');
    expect(validateWizardStep('round', { ...s, name: 'Open' })).toBe('Pick the date.');
    expect(validateWizardStep('round', { ...s, rounds: [{ ...emptyRoundDraft(), scheduled_on: '2030-06-01' }] })).toBe('Pick a course, or type its name.');
    expect(validateWizardStep('round', { ...filled(), rounds: [{ ...round1, holes: 18, starting_hole: 10 }] })).toBe('An 18-hole round starts on hole 1.');
    expect(validateWizardStep('format', { ...filled(), capacity: '0' })).toContain('Field size');
    expect(validateWizardStep('format', { ...filled(), capacity: '' })).toBeNull();
    expect(validateWizardStep('review', filled())).toBeNull();
    expect(validateWizardStep('review', { ...filled(), name: '' })).toBe('Give the event a name.');
  });
  it('dirty means anything typed or picked', () => {
    expect(isWizardDirty(emptyWizardState())).toBe(false);
    expect(isWizardDirty({ ...emptyWizardState(), name: 'x' })).toBe(true);
    expect(isWizardDirty({ ...emptyWizardState(), rounds: [{ ...emptyRoundDraft(), holes: 9 }] })).toBe(true);
    expect(isWizardDirty(addWizardRound(emptyWizardState()))).toBe(true);
  });
  it('the rounds list: add copies the previous course with an empty date, remove never takes the first, the refusals name the round and the order', () => {
    const one = filled();
    const two = addWizardRound(one);
    expect(two.rounds).toHaveLength(2);
    expect(two.rounds[1]).toEqual({ ...round1, scheduled_on: '' });
    expect(validateWizardRounds(two.rounds)).toBe('Round 2: Pick the date.');
    const early = updateWizardRound(two, 1, { scheduled_on: '2030-05-31' });
    expect(validateWizardRounds(early.rounds)).toBe('Round 2 must not be before round 1.');
    const ok = updateWizardRound(two, 1, { scheduled_on: '2030-06-02' });
    expect(validateWizardRounds(ok.rounds)).toBeNull();
    expect(validateWizardRounds([])).toBe('Add a round.');
    expect(removeWizardRound(ok, 0)).toBe(ok);
    expect(removeWizardRound(ok, 1).rounds).toHaveLength(1);
    let full = one;
    for (let i = 0; i < 10; i++) full = addWizardRound(full);
    expect(full.rounds).toHaveLength(8);
    expect(wizardToCreateBody(ok, { publish: true, profileId: null })).toMatchObject({ rounds: [{ scheduled_on: '2030-06-01' }, { scheduled_on: '2030-06-02' }] });
    expect('round' in wizardToCreateBody(ok, { publish: true, profileId: null })).toBe(false);
  });
  it('the body is the create route\'s shape; a nine keeps its start, an eighteen starts on 1; blanks become null', () => {
    expect(wizardToCreateBody(filled(), { publish: true, profileId: null })).toEqual({
      name: 'Spring Open', description: null, sport_key: 'golf', visibility: 'private', join_mode: 'invite', format: 'stroke_net', capacity: 8, club_id: null, league_id: null, host_plays: true, publish: true, profile_id: null,
      round: { scheduled_on: '2030-06-01', course_id: null, course_name: 'Eagle Creek', tee: null, holes: 9, starting_hole: 10 },
    });
    const body = wizardToCreateBody({ ...filled(), rounds: [{ ...round1, holes: 18, tee: ' Blue ' }], org: { kind: 'club', id: 'c1' } }, { publish: false, profileId: 'child' });
    expect(body).toMatchObject({ club_id: 'c1', league_id: null, publish: false, profile_id: 'child', round: { starting_hole: 1, tee: 'Blue' } });
  });
  it('a catalog course brings its tees from the ratings, else the yardages', () => {
    expect(wizardCourseFrom({ id: 'c', name: 'Eagle', courseRating: { Blue: 71.5, White: 69.9 }, slopeRating: { Blue: 128 }, holesCount: 18 })).toEqual({ id: 'c', name: 'Eagle', tees: ['Blue', 'White'], holesCount: 18 });
    expect(wizardCourseFrom({ id: 'c', name: 'Nine', holes: [{ number: 1, par: 4, yardage: { red: 300 }, handicap: 1 }] })).toEqual({ id: 'c', name: 'Nine', tees: ['red'], holesCount: 1 });
  });
});
