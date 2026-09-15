import { describe, expect, it } from 'vitest';
import { isDateOnly, MAX_ROUNDS, parseCreateBody, parseEventPatch, parseInviteBody, parseListScope, parseParticipantPatch, parseRoundInput } from '../validate';

const round = { scheduled_on: '2026-10-03', course_name: 'Eagle Creek', holes: 18, starting_hole: 1 };
const create = (over: Record<string, unknown> = {}) => ({ name: 'Spring Open', round, ...over });

describe('isDateOnly — the date-only class', () => {
  it('accepts a real calendar date and nothing else', () => {
    expect(isDateOnly('2026-10-03')).toBe(true);
    expect(isDateOnly('2026-02-29')).toBe(false); // not a leap year
    expect(isDateOnly('2028-02-29')).toBe(true);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('2026-10-03T00:00:00Z')).toBe(false);
    expect(isDateOnly(20261003)).toBe(false);
  });
});

describe('parseRoundInput', () => {
  it('needs a date and a course (id or name); defaults 18 from hole 1', () => {
    expect(parseRoundInput({ scheduled_on: '2026-10-03', course_name: 'X' })).toEqual({ ok: true, value: { scheduled_on: '2026-10-03', name: null, course_id: null, course_name: 'X', tee: null, holes: 18, starting_hole: 1 } });
    expect(parseRoundInput({ scheduled_on: 'tomorrow', course_name: 'X' })).toMatchObject({ ok: false, error: expect.stringContaining('scheduled_on') });
    expect(parseRoundInput({ scheduled_on: '2026-10-03' })).toMatchObject({ ok: false, error: expect.stringContaining('course_name') });
    expect(parseRoundInput({ scheduled_on: '2026-10-03', course_id: 'nope' })).toMatchObject({ ok: false, error: expect.stringContaining('course_id') });
  });
  it('a nine may start on 10; an eighteen may not', () => {
    expect(parseRoundInput({ ...round, holes: 9, starting_hole: 10 })).toMatchObject({ ok: true, value: { holes: 9, starting_hole: 10 } });
    expect(parseRoundInput({ ...round, holes: 18, starting_hole: 10 })).toMatchObject({ ok: false });
    expect(parseRoundInput({ ...round, holes: 12 })).toMatchObject({ ok: false, error: expect.stringContaining('holes') });
  });
});

describe('parseCreateBody', () => {
  it('fills the defaults: private, invite, gross, golf, host plays, draft', () => {
    const r = parseCreateBody(create());
    expect(r).toMatchObject({ ok: true, value: { name: 'Spring Open', visibility: 'private', join_mode: 'invite', format: 'stroke_gross', sport_key: 'golf', host_plays: true, publish: false, capacity: null, club_id: null, league_id: null, profile_id: null } });
  });
  it('names the field it refuses; never clamps', () => {
    expect(parseCreateBody(create({ name: '   ' }))).toMatchObject({ ok: false, error: 'name is required' });
    expect(parseCreateBody(create({ name: 'x'.repeat(121) }))).toMatchObject({ ok: false, error: expect.stringContaining('name') });
    expect(parseCreateBody(create({ visibility: 'friends' }))).toMatchObject({ ok: false, error: expect.stringContaining('visibility') });
    expect(parseCreateBody(create({ capacity: 0 }))).toMatchObject({ ok: false, error: expect.stringContaining('capacity') });
    expect(parseCreateBody(create({ capacity: 2.5 }))).toMatchObject({ ok: false });
    expect(parseCreateBody(create({ sport_key: 'tennis' }))).toMatchObject({ ok: false, error: expect.stringContaining('sport_key') });
    expect(parseCreateBody(create({ club_id: '11111111-1111-4111-8111-111111111111', league_id: '11111111-1111-4111-8111-111111111112' }))).toMatchObject({ ok: false, error: expect.stringContaining('not both') });
    expect(parseCreateBody(create({ host_plays: 'yes' }))).toMatchObject({ ok: false });
    expect(parseCreateBody(null)).toMatchObject({ ok: false });
  });
  it('trims text and turns an empty description into null', () => {
    expect(parseCreateBody(create({ name: '  Open  ', description: '   ' }))).toMatchObject({ ok: true, value: { name: 'Open', description: null } });
  });
});

describe('parseEventPatch', () => {
  it('takes only known fields; an unknown one is refused, an empty patch too', () => {
    expect(parseEventPatch({ capacity: 8 })).toEqual({ ok: true, value: { capacity: 8 } });
    expect(parseEventPatch({ capacity: null })).toEqual({ ok: true, value: { capacity: null } });
    expect(parseEventPatch({ status: 'live' })).toMatchObject({ ok: false, error: 'Unknown field: status' });
    expect(parseEventPatch({})).toMatchObject({ ok: false, error: 'Nothing to change' });
    expect(parseEventPatch({ name: '' })).toMatchObject({ ok: false, error: 'name cannot be empty' });
  });
});

describe('parseInviteBody / parseParticipantPatch / parseListScope', () => {
  it('invites: ids and handles, deduped, lower-cased handles, 50 max', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseInviteBody({ profile_ids: [id, id], handles: ['Sam_K', 'sam_k'] })).toEqual({ ok: true, value: { profileIds: [id], handles: ['sam_k'] } });
    expect(parseInviteBody({})).toMatchObject({ ok: false, error: 'Nobody to invite' });
    expect(parseInviteBody({ profile_ids: ['x'] })).toMatchObject({ ok: false });
    expect(parseInviteBody({ handles: Array.from({ length: 51 }, (_, i) => `h${i}`) })).toMatchObject({ ok: false, error: expect.stringContaining('50') });
  });
  it('participant patch: the index to one decimal, null clears, booleans only', () => {
    expect(parseParticipantPatch({ handicap_index: 12.34 })).toEqual({ ok: true, value: { handicap_index: 12.3 } });
    expect(parseParticipantPatch({ handicap_index: null })).toEqual({ ok: true, value: { handicap_index: null } });
    expect(parseParticipantPatch({ handicap_index: 60 })).toMatchObject({ ok: false });
    expect(parseParticipantPatch({ hide_from_profile: 'yes' })).toMatchObject({ ok: false });
    expect(parseParticipantPatch({ playing: false, hide_from_profile: true })).toEqual({ ok: true, value: { playing: false, hide_from_profile: true } });
    expect(parseParticipantPatch({ role: 'organizer' })).toMatchObject({ ok: false, error: 'Unknown field: role' });
  });
  it('list scope defaults to mine', () => {
    expect(parseListScope('live')).toBe('live');
    expect(parseListScope('everything')).toBe('mine');
    expect(parseListScope(null)).toBe('mine');
  });
});

describe('parseRoundsInput — round or rounds[] (phase 2)', () => {
  it("phase 1's single round is round 1; both shapes at once are refused", () => {
    const one = parseCreateBody(create());
    expect(one.ok && one.value.rounds).toHaveLength(1);
    expect(parseCreateBody(create({ rounds: [round] }))).toMatchObject({ ok: false, error: 'Send round or rounds, not both' });
  });
  it('a list keeps sequence order and non-decreasing dates; a miss names rounds[i]', () => {
    const two = parseCreateBody({ name: 'Open', rounds: [round, { ...round, scheduled_on: '2026-10-04' }] });
    expect(two.ok && two.value.rounds.map(r => r.scheduled_on)).toEqual(['2026-10-03', '2026-10-04']);
    expect(parseCreateBody({ name: 'Open', rounds: [round, { ...round, scheduled_on: '2026-10-02' }] })).toMatchObject({ ok: false, error: 'rounds[1].scheduled_on must not be before rounds[0].scheduled_on' });
    expect(parseCreateBody({ name: 'Open', rounds: [round, { ...round, holes: 12 }] })).toMatchObject({ ok: false, error: expect.stringContaining('rounds[1].holes') });
    expect(parseCreateBody({ name: 'Open', rounds: [round, { scheduled_on: '2026-10-04' }] })).toMatchObject({ ok: false, error: expect.stringContaining('rounds[1].course_name') });
  });
  it('an empty list and more than MAX_ROUNDS are refused', () => {
    expect(parseCreateBody({ name: 'Open', rounds: [] })).toMatchObject({ ok: false, error: expect.stringContaining('non-empty') });
    expect(parseCreateBody({ name: 'Open', rounds: Array.from({ length: MAX_ROUNDS + 1 }, () => round) })).toMatchObject({ ok: false, error: expect.stringContaining(`at most ${MAX_ROUNDS}`) });
    expect(parseCreateBody({ name: 'Open', rounds: Array.from({ length: MAX_ROUNDS }, () => round) })).toMatchObject({ ok: true });
  });
  it('the same date twice in a row is fine (36 holes in a day)', () => {
    expect(parseCreateBody({ name: 'Open', rounds: [round, round] })).toMatchObject({ ok: true });
  });
});

describe('the participant patch — phase 2 fields', () => {
  it('flight and waitlist_position are known; a bad place is refused by name', () => {
    expect(parseParticipantPatch({ flight: ' A ' })).toEqual({ ok: true, value: { flight: 'A' } });
    expect(parseParticipantPatch({ flight: '' })).toEqual({ ok: true, value: { flight: null } });
    expect(parseParticipantPatch({ waitlist_position: 2 })).toEqual({ ok: true, value: { waitlist_position: 2 } });
    expect(parseParticipantPatch({ waitlist_position: 0 })).toMatchObject({ ok: false, error: expect.stringContaining('waitlist_position') });
    expect(parseParticipantPatch({ waitlist_position: 1.5 })).toMatchObject({ ok: false });
    expect(parseParticipantPatch({ flite: 'A' })).toEqual({ ok: false, error: 'Unknown field: flite' });
  });
});

describe('phase 2 fields on the round and the event patch', () => {
  it('a round may carry a name (1..40); the event patch passes format_config through as an object', () => {
    expect(parseRoundInput({ ...round, name: ' Saturday ' })).toMatchObject({ ok: true, value: { name: 'Saturday' } });
    expect(parseRoundInput({ ...round, name: '' })).toMatchObject({ ok: true, value: { name: null } });
    expect(parseRoundInput({ ...round, name: 'x'.repeat(41) })).toMatchObject({ ok: false, error: expect.stringContaining('round.name') });
    expect(parseEventPatch({ format_config: { cut: { after_round: 1, top_n: 5 } } })).toEqual({ ok: true, value: { format_config: { cut: { after_round: 1, top_n: 5 } } } });
    expect(parseEventPatch({ format_config: 'x' })).toMatchObject({ ok: false, error: 'format_config must be an object' });
  });
});
