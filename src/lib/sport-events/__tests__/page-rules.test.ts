import { describe, expect, it } from 'vitest';
import { fieldLine, formatDateOnly, headerRoundLine, holesLabel, joinLine, ROUND_STATUS_LABEL, roundsSummary } from '../format';
import { joinControl, type JoinStateInput } from '../join-state';
import { confirmCopyFor, nextOrganizerStep, ROUND_ACTION_LABEL, roundActionsFor, type RoundForRules } from '../page-rules';
import { defaultRoundFor, offersOverall, parseEventTab, parseRoundParam, roundsForTab, type RoundForTabs } from '../tabs';
import { emptyRoundDraft, roundBodyFrom, roundDraftFrom, validateRoundDraft } from '../wizard';

describe('the event page rules', () => {
  it('tabs: unknown → overview; the four deep links parse', () => {
    expect(parseEventTab(null)).toBe('overview');
    expect(parseEventTab('players')).toBe('players');
    expect(parseEventTab('nonsense')).toBe('overview');
  });
  it('dates format from their parts (never the local parser); labels read as English', () => {
    expect(formatDateOnly('2030-06-01')).toBe('Jun 1, 2030');
    expect(formatDateOnly('2030-06-01', { weekday: true })).toBe('Sat, Jun 1, 2030');
    expect(formatDateOnly('2030-12-31')).toBe('Dec 31, 2030');
    expect(formatDateOnly(null)).toBe('');
    expect(holesLabel(9, 10)).toBe('9 holes from the 10th');
    expect(holesLabel(18, 1)).toBe('18 holes');
    expect(joinLine('request')).toBe('Open to requests');
    expect(fieldLine({ playing: 3, waitlisted: 1 }, 8)).toBe('3 of 8 playing · 1 waitlisted');
    expect(fieldLine({ playing: 3, waitlisted: 0 }, null)).toBe('3 playing');
  });
  it('the join control per viewer', () => {
    const base: JoinStateInput = { signedIn: true, canManage: false, role: 'viewer', participantStatus: null, playing: false, waitlistPosition: null, event: { status: 'open', joinMode: 'invite' } };
    expect(joinControl({ ...base, signedIn: false })).toEqual({ kind: 'none' });
    expect(joinControl({ ...base, canManage: true })).toEqual({ kind: 'manage' });
    expect(joinControl(base)).toEqual({ kind: 'follow' });
    expect(joinControl({ ...base, event: { status: 'open', joinMode: 'request' } })).toEqual({ kind: 'request' });
    expect(joinControl({ ...base, event: { status: 'draft', joinMode: 'request' } })).toEqual({ kind: 'follow' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'invited' })).toEqual({ kind: 'respond' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'requested' })).toEqual({ kind: 'requested' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'accepted', playing: true })).toEqual({ kind: 'in', playing: true });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'waitlisted', waitlistPosition: 2 })).toEqual({ kind: 'waitlisted', position: 2 });
    expect(joinControl({ ...base, role: 'follower', participantStatus: 'accepted' })).toEqual({ kind: 'following' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'withdrawn' })).toEqual({ kind: 'follow' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'removed', event: { status: 'open', joinMode: 'request' } })).toEqual({ kind: 'follow' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'invited', event: { status: 'completed', joinMode: 'invite' } })).toEqual({ kind: 'none' });
    expect(joinControl({ ...base, role: 'participant', participantStatus: 'accepted', playing: true, event: { status: 'completed', joinMode: 'invite' } })).toEqual({ kind: 'in', playing: true });
  });
});

describe('the round the page shows (phase 2)', () => {
  const r = (id: string, sequence: number, status: RoundForTabs['status'], minted = false): RoundForTabs => ({ id, sequence, status, group_post_id: minted ? `gp-${id}` : null });
  const one = [r('a', 1, 'scheduled')];
  const two = [r('a', 1, 'completed', true), r('b', 2, 'live', true), r('c', 3, 'scheduled')];

  it('the leaderboard offers the overall board only on a tournament', () => {
    expect(offersOverall('leaderboard', one)).toBe(false);
    expect(offersOverall('leaderboard', two)).toBe(true);
    expect(offersOverall('scorecard', two)).toBe(false);
    expect(offersOverall('leaderboard', [r('a', 1, 'scheduled'), r('b', 2, 'cancelled')])).toBe(false);
  });
  it('defaults: overall on the tournament board; the current round elsewhere; the scorecard only among minted rounds', () => {
    expect(defaultRoundFor('leaderboard', two)).toBe('overall');
    expect(defaultRoundFor('leaderboard', one)).toBe('a');
    expect(defaultRoundFor('schedule', two)).toBe('b');
    expect(defaultRoundFor('groups', [r('a', 1, 'completed', true), r('b', 2, 'scheduled')])).toBe('b');
    expect(defaultRoundFor('scorecard', two)).toBe('b');
    expect(defaultRoundFor('scorecard', [r('a', 1, 'completed', true), r('b', 2, 'scheduled')])).toBe('a');
    expect(defaultRoundFor('scorecard', one)).toBeNull();
    expect(defaultRoundFor('leaderboard', [])).toBeNull();
  });
  it('?round= parses to what the tab can show, else the default — never a blank panel', () => {
    expect(parseRoundParam('overall', two, 'leaderboard')).toBe('overall');
    expect(parseRoundParam('overall', one, 'leaderboard')).toBe('a');
    expect(parseRoundParam('overall', two, 'scorecard')).toBe('b');
    expect(parseRoundParam('c', two, 'leaderboard')).toBe('c');
    expect(parseRoundParam('c', two, 'scorecard')).toBe('b'); // not minted
    expect(parseRoundParam('nope', two, 'groups')).toBe('b');
    expect(parseRoundParam(null, two, 'leaderboard')).toBe('overall');
    expect(roundsForTab('scorecard', two).map(x => x.id)).toEqual(['a', 'b']);
  });
});

describe('the header round line and the rounds summary (phase 2)', () => {
  const rr = (sequence: number, scheduled_on: string, status: string, course_name = 'Eagle Creek') => ({ sequence, scheduled_on, status, course_name });
  it('one round reads as phase 1; a tournament names the round in focus and the next one', () => {
    expect(headerRoundLine([rr(1, '2030-06-01', 'scheduled')], null)).toEqual({ primary: 'Sat, Jun 1, 2030 · Eagle Creek', secondary: null });
    expect(headerRoundLine([rr(1, '2030-06-01', 'scheduled'), rr(2, '2030-06-02', 'scheduled')], '2030-06-01')).toEqual({ primary: 'Round 1 of 2 · Sat, Jun 1, 2030 · Eagle Creek · today', secondary: 'Next: Round 2 · Sun, Jun 2, 2030' });
    expect(headerRoundLine([rr(1, '2030-06-01', 'live'), rr(2, '2030-06-02', 'scheduled')], null).primary).toBe('Round 1 of 2 · Sat, Jun 1, 2030 · Eagle Creek · live');
    expect(headerRoundLine([rr(1, '2030-06-01', 'completed'), rr(2, '2030-06-02', 'scheduled')], '2030-06-05')).toEqual({ primary: 'Round 2 of 2 · Sun, Jun 2, 2030 · Eagle Creek', secondary: null });
    expect(headerRoundLine([rr(1, '2030-06-01', 'completed'), rr(2, '2030-06-02', 'completed')], null).primary).toBe('Round 2 of 2 · Sun, Jun 2, 2030 · Eagle Creek · final');
    expect(headerRoundLine([rr(1, '2030-06-01', 'cancelled'), rr(2, '2030-06-02', 'scheduled')], null).primary).toBe('Sun, Jun 2, 2030 · Eagle Creek');
    expect(headerRoundLine([], null)).toEqual({ primary: '', secondary: null });
  });
  it('the summary: one date, or "n rounds · Jun 1 – Jun 3, 2030"', () => {
    expect(roundsSummary([rr(1, '2030-06-01', 'scheduled')])).toBe('Sat, Jun 1, 2030');
    expect(roundsSummary([rr(1, '2030-06-01', 'scheduled'), rr(2, '2030-06-03', 'scheduled')])).toBe('2 rounds · Jun 1 – Jun 3, 2030');
    expect(roundsSummary([rr(1, '2030-06-01', 'scheduled'), rr(2, '2030-06-01', 'scheduled')])).toBe('2 rounds · Sat, Jun 1, 2030');
    expect(roundsSummary([rr(1, '2030-12-31', 'scheduled'), rr(2, '2031-01-01', 'scheduled')])).toBe('2 rounds · Dec 31, 2030 – Jan 1, 2031');
    expect(ROUND_STATUS_LABEL.completed).toBe('Final');
  });
});

describe('the organizer rules (phase 2)', () => {
  const r = (id: string, sequence: number, status: RoundForRules['status']): RoundForRules => ({ id, sequence, status });
  it('the header\'s one step: publish → start the next round → complete the live one → nothing', () => {
    expect(nextOrganizerStep({ status: 'draft' }, [r('a', 1, 'scheduled')])).toEqual({ kind: 'publish' });
    expect(nextOrganizerStep({ status: 'open' }, [r('a', 1, 'scheduled'), r('b', 2, 'scheduled')])).toEqual({ kind: 'start', round: r('a', 1, 'scheduled') });
    expect(nextOrganizerStep({ status: 'live' }, [r('a', 1, 'live'), r('b', 2, 'scheduled')])).toEqual({ kind: 'complete', round: r('a', 1, 'live') });
    expect(nextOrganizerStep({ status: 'live' }, [r('a', 1, 'completed'), r('b', 2, 'scheduled')])).toEqual({ kind: 'start', round: r('b', 2, 'scheduled') });
    expect(nextOrganizerStep({ status: 'live' }, [r('a', 1, 'completed'), r('b', 2, 'cancelled')])).toBeNull();
    expect(nextOrganizerStep({ status: 'completed' }, [r('a', 1, 'completed')])).toBeNull();
    expect(nextOrganizerStep({ status: 'open' }, [])).toBeNull();
  });
  it('a round card offers only what the lifecycle accepts', () => {
    const rounds = [r('a', 1, 'completed'), r('b', 2, 'scheduled'), r('c', 3, 'scheduled')];
    expect(roundActionsFor(rounds[0], rounds, { status: 'live' })).toEqual([]);
    expect(roundActionsFor(rounds[1], rounds, { status: 'live' })).toEqual(['start', 'edit', 'remove', 'cancel']);
    expect(roundActionsFor(rounds[2], rounds, { status: 'live' })).toEqual(['edit', 'remove', 'cancel']);
    expect(roundActionsFor(r('a', 1, 'live'), [r('a', 1, 'live')], { status: 'live' })).toEqual(['complete']);
    expect(roundActionsFor(r('a', 1, 'scheduled'), [r('a', 1, 'scheduled')], { status: 'draft' })).toEqual(['edit']); // the last round: no remove, no cancel; a draft never starts
    expect(roundActionsFor(r('a', 1, 'scheduled'), [r('a', 1, 'scheduled'), r('b', 2, 'scheduled')], { status: 'open' })).toEqual(['start', 'edit', 'remove', 'cancel']);
    expect(roundActionsFor(r('a', 1, 'scheduled'), [r('a', 1, 'scheduled')], { status: 'completed' })).toEqual([]);
  });
  it('the confirm copy: phase 1 words on a single round; the round named on a tournament; the last round says so', () => {
    expect(confirmCopyFor('start', r('a', 1, 'scheduled'), [r('a', 1, 'scheduled')])).toMatchObject({ title: 'Go live?', confirmText: 'Go live' });
    expect(confirmCopyFor('start', r('a', 1, 'scheduled'), [r('a', 1, 'scheduled'), r('b', 2, 'scheduled')])).toMatchObject({ title: 'Start round 1?', confirmText: 'Start round 1' });
    expect(confirmCopyFor('complete', r('a', 1, 'live'), [r('a', 1, 'live')])).toMatchObject({ title: 'Complete the event?' });
    expect(confirmCopyFor('complete', r('a', 1, 'live'), [r('a', 1, 'live'), r('b', 2, 'scheduled')]).message).toContain('stays live');
    expect(confirmCopyFor('complete', r('b', 2, 'live'), [r('a', 1, 'completed'), r('b', 2, 'live')]).message).toContain('last round');
    expect(confirmCopyFor('cancel', r('b', 2, 'scheduled'), [])).toMatchObject({ danger: true, confirmText: 'Cancel round' });
    expect(confirmCopyFor('remove', r('b', 2, 'scheduled'), [])).toMatchObject({ danger: true, title: 'Remove round 2?' });
    expect(ROUND_ACTION_LABEL.cancel).toBe('Cancel round');
  });
});

describe('the round draft (phase 2)', () => {
  it('a stored round becomes a draft and back; the refusals name the miss', () => {
    const d = roundDraftFrom({ scheduled_on: '2030-06-01', course_id: null, course_name: 'QA Links', tee: null, holes: 9, starting_hole: 10 });
    expect(d).toEqual({ scheduled_on: '2030-06-01', course: { id: null, name: 'QA Links', tees: [], holesCount: null }, tee: '', holes: 9, starting_hole: 10 });
    expect(roundBodyFrom(d)).toEqual({ scheduled_on: '2030-06-01', course_id: null, course_name: 'QA Links', tee: null, holes: 9, starting_hole: 10 });
    expect(roundBodyFrom({ ...d, holes: 18 })).toMatchObject({ starting_hole: 1 });
    expect(validateRoundDraft(emptyRoundDraft())).toBe('Pick the date.');
    expect(validateRoundDraft({ ...emptyRoundDraft(), scheduled_on: '2030-06-01' })).toBe('Pick a course, or type its name.');
    expect(validateRoundDraft({ ...d, holes: 18, starting_hole: 10 })).toBe('An 18-hole round starts on hole 1.');
    expect(validateRoundDraft(d)).toBeNull();
  });
});
