import { describe, expect, it } from 'vitest';
import { addWizardRound, emptyRoundDraft, emptyWizardState, isWizardDirty, removeWizardRound, updateWizardRound, validateWizardRounds, validateWizardStep, withVisibility, wizardCourseFrom, wizardToCreateBody, type RoundDraft, type WizardState, withSideTeam, withSport } from '../wizard';

const round1: RoundDraft = { scheduled_on: '2030-06-01', name: '', course: { id: null, name: 'Eagle Creek', tees: [], holesCount: null }, tee: '', holes: 9, starting_hole: 10, place: '', starts_at: '' };
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
    // Phase 3: a match-play event never counts toward a competition; a bracket needs two rounds.
    expect(validateWizardStep('format', { ...filled(), format: 'match_gross', org: { kind: 'club', id: 'c1' }, competition: 'k1' })).toContain('match-play');
    expect(validateWizardStep('format', { ...filled(), format: 'match_net', match: { sides: 'singles', bracket: true } })).toContain('at least two rounds');
    expect(validateWizardStep('format', { ...filled(), format: 'match_net', match: { sides: 'fourball', bracket: true }, rounds: [round1, { ...round1, scheduled_on: '2030-06-02' }] })).toBeNull();
  });
  it('phase 4: the wizard starts public + open; a visibility pick re-seats joining unless joining was touched', () => {
    expect(emptyWizardState()).toMatchObject({ visibility: 'public', join_mode: 'open' });
    expect(withVisibility(emptyWizardState(), 'private', false).join_mode).toBe('invite');
    expect(withVisibility(emptyWizardState(), 'link', false).join_mode).toBe('invite');
    expect(withVisibility({ ...emptyWizardState(), join_mode: 'request' }, 'private', true).join_mode).toBe('request');
    expect(withVisibility(withVisibility(emptyWizardState(), 'private', false), 'public', false).join_mode).toBe('open');
  });
  it('dirty means anything typed or picked', () => {
    expect(isWizardDirty(emptyWizardState())).toBe(false);
    expect(isWizardDirty({ ...emptyWizardState(), name: 'x' })).toBe(true);
    expect(isWizardDirty({ ...emptyWizardState(), rounds: [{ ...emptyRoundDraft(), holes: 9 }] })).toBe(true);
    expect(isWizardDirty(addWizardRound(emptyWizardState()))).toBe(true);
    expect(isWizardDirty({ ...emptyWizardState(), match: { sides: 'fourball', bracket: false } })).toBe(true);
  });
  it('the rounds list: add copies the previous course with an empty date, remove never takes the first, the refusals name the round and the order', () => {
    const one = filled();
    const two = addWizardRound(one);
    expect(two.rounds).toHaveLength(2);
    expect(two.rounds[1]).toEqual({ ...round1, scheduled_on: '', name: '' });
    expect(wizardToCreateBody({ ...one, rounds: [{ ...round1, name: ' Saturday ' }] }, { publish: true, profileId: null })).toMatchObject({ round: { name: 'Saturday' } });
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
      name: 'Spring Open', description: null, sport_key: 'golf', visibility: 'public', join_mode: 'open', format: 'stroke_net', capacity: 8, club_id: null, league_id: null, competition_id: null, host_plays: true, self_entry: true, publish: true, profile_id: null,
      round: { scheduled_on: '2030-06-01', name: null, course_id: null, course_name: 'Eagle Creek', tee: null, holes: 9, starting_hole: 10 },
    });
    const body = wizardToCreateBody({ ...filled(), rounds: [{ ...round1, holes: 18, tee: ' Blue ' }], org: { kind: 'club', id: 'c1' } }, { publish: false, profileId: 'child' });
    expect(body).toMatchObject({ club_id: 'c1', league_id: null, publish: false, profile_id: 'child', round: { starting_hole: 1, tee: 'Blue' } });
    // Phase 3: a match format carries its shape as format_config.match; a stroke format sends no format_config.
    expect('format_config' in wizardToCreateBody(filled(), { publish: true, profileId: null })).toBe(false);
    expect(wizardToCreateBody({ ...filled(), format: 'match_net', match: { sides: 'foursomes', bracket: true } }, { publish: true, profileId: null })).toMatchObject({ format: 'match_net', format_config: { match: { sides: 'foursomes', bracket: true } } });
  });
  it('a catalog course brings its tees from the ratings, else the yardages', () => {
    expect(wizardCourseFrom({ id: 'c', name: 'Eagle', courseRating: { Blue: 71.5, White: 69.9 }, slopeRating: { Blue: 128 }, holesCount: 18 })).toEqual({ id: 'c', name: 'Eagle', tees: ['Blue', 'White'], holesCount: 18 });
    expect(wizardCourseFrom({ id: 'c', name: 'Nine', holes: [{ number: 1, par: 4, yardage: { red: 300 }, handicap: 1 }] })).toEqual({ id: 'c', name: 'Nine', tees: ['red'], holesCount: 1 });
  });
});

describe('side teams (leftovers PR 5)', () => {
  it('a pick fills the name, both or neither validates, the body carries the ids', () => {
    let s = withSport(emptyWizardState(), 'ice_hockey');
    s = { ...s, name: 'Game', rounds: [{ ...s.rounds[0], scheduled_on: '2030-06-01', course: null, name: '', tee: '', place: 'Rink' } as typeof s.rounds[0]] };
    s = withSideTeam(s, 0, { id: '11111111-1111-4111-8111-111111111111', name: 'Reds' });
    expect(s.side_names[0]).toBe('Reds');
    expect(validateWizardStep('format', s)).toBe('Pick both teams, or neither.');
    s = withSideTeam(s, 1, { id: '11111111-1111-4111-8111-111111111111', name: 'Reds' });
    expect(validateWizardStep('format', s)).toBe('Pick two different teams.');
    s = withSideTeam(s, 1, { id: '22222222-2222-4222-8222-222222222222', name: 'Blues' });
    expect(validateWizardStep('format', s)).toBeNull();
    const body = wizardToCreateBody(s, { publish: true, profileId: null }) as { format_config?: { game?: { side_names: string[]; side_team_ids?: string[] } } };
    expect(body.format_config?.game).toEqual({ side_names: ['Reds', 'Blues'], side_team_ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'] });
    expect(isWizardDirty(withSideTeam(emptyWizardState(), 0, { id: 'x', name: 'X' }))).toBe(true);
    s = withSideTeam(s, 1, null);
    expect([s.side_teams[1], s.side_names[1]]).toEqual([null, 'Blues']);
  });
});
