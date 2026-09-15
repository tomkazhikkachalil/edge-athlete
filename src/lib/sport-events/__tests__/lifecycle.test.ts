import { describe, expect, it } from 'vitest';
import { canRoundTransition, canTransition, eventStatusAfterRound, nextStartableRound, ROUND_REFUSAL_COPY, ROUND_TRANSITIONS, TRANSITION_REFUSAL_COPY, TRANSITIONS, transitionStamp, validateRoundTransition, validateTransition, type RoundTransitionFacts, type TransitionFacts } from '../lifecycle';

const facts = (over: Partial<TransitionFacts> = {}): TransitionFacts => ({ name: 'Spring Open', rounds: [{ scheduledOn: '2026-10-01', groupPostMinted: false }], acceptedPlaying: 2, cards: [{ status: 'final' }, { status: 'final' }], ...over });

describe('the organizer-intent lifecycle', () => {
  it('the table: draft → open | cancelled, open → live | cancelled, live → completed, terminal after', () => {
    expect(TRANSITIONS.draft).toEqual(['open', 'cancelled']);
    expect(TRANSITIONS.open).toEqual(['live', 'cancelled']);
    expect(TRANSITIONS.live).toEqual(['completed']);
    expect(TRANSITIONS.completed).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual([]);
    expect(canTransition('live', 'cancelled')).toBe(false);
    expect(validateTransition('completed', 'open', facts())).toEqual({ ok: false, reason: 'invalid_transition' });
  });
  it('draft → open needs a name and a round', () => {
    expect(validateTransition('draft', 'open', facts({ name: '  ' }))).toEqual({ ok: false, reason: 'name_required' });
    expect(validateTransition('draft', 'open', facts({ rounds: [] }))).toEqual({ ok: false, reason: 'round_required' });
    expect(validateTransition('draft', 'open', facts())).toEqual({ ok: true });
  });
  it('open → live needs an accepted player and a minted round', () => {
    expect(validateTransition('open', 'live', facts({ acceptedPlaying: 0 }))).toEqual({ ok: false, reason: 'no_players' });
    expect(validateTransition('open', 'live', facts())).toEqual({ ok: false, reason: 'round_not_minted' });
    expect(validateTransition('open', 'live', facts({ rounds: [{ scheduledOn: 'd', groupPostMinted: true }] }))).toEqual({ ok: true });
  });
  it('live → completed needs every card final, unless the organizer overrides', () => {
    expect(validateTransition('live', 'completed', facts({ cards: [{ status: 'final' }, { status: 'submitted' }] }))).toEqual({ ok: false, reason: 'cards_not_final' });
    expect(validateTransition('live', 'completed', facts({ cards: [{ status: 'final' }, { status: 'in_progress' }] }))).toEqual({ ok: false, reason: 'cards_not_final' }); // a player never started reads in_progress
    expect(validateTransition('live', 'completed', facts({ cards: [{ status: 'final' }] }))).toEqual({ ok: true }); // the round's FIELD is one player (past a cut) — the roster is never the measure
    expect(validateTransition('live', 'completed', facts({ cards: [] }))).toEqual({ ok: false, reason: 'cards_not_final' }); // an empty field never completes
    expect(validateTransition('live', 'completed', facts({ cards: [{ status: 'in_progress' }], override: true }))).toEqual({ ok: true });
    expect(validateTransition('live', 'completed', facts())).toEqual({ ok: true });
  });
  it('cancel from draft or open only', () => {
    expect(validateTransition('draft', 'cancelled', facts())).toEqual({ ok: true });
    expect(validateTransition('open', 'cancelled', facts())).toEqual({ ok: true });
    expect(validateTransition('live', 'cancelled', facts())).toEqual({ ok: false, reason: 'invalid_transition' });
  });
  it('each transition stamps its own column', () => {
    expect(transitionStamp('open')).toBe('opened_at');
    expect(transitionStamp('live')).toBe('went_live_at');
    expect(transitionStamp('completed')).toBe('completed_at');
    expect(transitionStamp('cancelled')).toBe('cancelled_at');
    expect(transitionStamp('draft')).toBeNull();
  });
});

describe('the round lifecycle (phase 2)', () => {
  const rf = (over: Partial<RoundTransitionFacts> = {}): RoundTransitionFacts => ({
    eventStatus: 'open',
    round: { sequence: 1, status: 'scheduled', groupPostMinted: true },
    rounds: [{ sequence: 1, status: 'scheduled' }, { sequence: 2, status: 'scheduled' }],
    acceptedPlaying: 2,
    cards: [{ status: 'final' }, { status: 'final' }],
    ...over,
  });

  it('the table: scheduled → live | cancelled, live → completed, terminal after; the event must not be over', () => {
    expect(ROUND_TRANSITIONS.scheduled).toEqual(['live', 'cancelled']);
    expect(ROUND_TRANSITIONS.live).toEqual(['completed']);
    expect(canRoundTransition('live', 'cancelled')).toBe(false);
    expect(validateRoundTransition('completed', rf())).toEqual({ ok: false, reason: 'invalid_transition' });
    expect(validateRoundTransition('live', rf({ eventStatus: 'completed' }))).toEqual({ ok: false, reason: 'event_over' });
    expect(validateRoundTransition('cancelled', rf({ eventStatus: 'cancelled' }))).toEqual({ ok: false, reason: 'event_over' });
  });

  it('a round starts only from an open or live event, one at a time, in order, with a player and a minted round', () => {
    expect(validateRoundTransition('live', rf())).toEqual({ ok: true });
    expect(validateRoundTransition('live', rf({ eventStatus: 'live', rounds: [{ sequence: 1, status: 'completed' }, { sequence: 2, status: 'scheduled' }], round: { sequence: 2, status: 'scheduled', groupPostMinted: true } }))).toEqual({ ok: true });
    expect(validateRoundTransition('live', rf({ eventStatus: 'draft' }))).toEqual({ ok: false, reason: 'event_not_open' });
    expect(validateRoundTransition('live', rf({ eventStatus: 'live', rounds: [{ sequence: 1, status: 'live' }, { sequence: 2, status: 'scheduled' }], round: { sequence: 2, status: 'scheduled', groupPostMinted: true } }))).toEqual({ ok: false, reason: 'another_round_live' });
    expect(validateRoundTransition('live', rf({ round: { sequence: 2, status: 'scheduled', groupPostMinted: true } }))).toEqual({ ok: false, reason: 'earlier_round_pending' });
    expect(validateRoundTransition('live', rf({ rounds: [{ sequence: 1, status: 'cancelled' }, { sequence: 2, status: 'scheduled' }], round: { sequence: 2, status: 'scheduled', groupPostMinted: true } }))).toEqual({ ok: true }); // a cancelled earlier round does not block
    expect(validateRoundTransition('live', rf({ acceptedPlaying: 0 }))).toEqual({ ok: false, reason: 'no_players' });
    expect(validateRoundTransition('live', rf({ round: { sequence: 1, status: 'scheduled', groupPostMinted: false } }))).toEqual({ ok: false, reason: 'round_not_minted' });
  });

  it('a round completes when THIS round\'s cards are all final, unless the organizer overrides', () => {
    const live = { sequence: 1, status: 'live' as const, groupPostMinted: true };
    expect(validateRoundTransition('completed', rf({ eventStatus: 'live', round: live }))).toEqual({ ok: true });
    expect(validateRoundTransition('completed', rf({ eventStatus: 'live', round: live, cards: [{ status: 'final' }, { status: 'submitted' }] }))).toEqual({ ok: false, reason: 'cards_not_final' });
    expect(validateRoundTransition('completed', rf({ eventStatus: 'live', round: live, cards: [{ status: 'final' }, { status: 'in_progress' }] }))).toEqual({ ok: false, reason: 'cards_not_final' }); // a player never started reads in_progress
    expect(validateRoundTransition('completed', rf({ eventStatus: 'live', round: live, cards: [{ status: 'final' }] }))).toEqual({ ok: true }); // the round's field past a cut
    expect(validateRoundTransition('completed', rf({ eventStatus: 'live', round: live, cards: [] }))).toEqual({ ok: false, reason: 'cards_not_final' });
    expect(validateRoundTransition('completed', rf({ eventStatus: 'live', round: live, cards: [{ status: 'in_progress' }], override: true }))).toEqual({ ok: true });
  });

  it('a scheduled round cancels unless it is the last non-cancelled round', () => {
    expect(validateRoundTransition('cancelled', rf())).toEqual({ ok: true });
    expect(validateRoundTransition('cancelled', rf({ rounds: [{ sequence: 1, status: 'scheduled' }] }))).toEqual({ ok: false, reason: 'last_round' });
    expect(validateRoundTransition('cancelled', rf({ rounds: [{ sequence: 1, status: 'scheduled' }, { sequence: 2, status: 'cancelled' }] }))).toEqual({ ok: false, reason: 'last_round' });
    expect(validateRoundTransition('cancelled', rf({ eventStatus: 'live', rounds: [{ sequence: 1, status: 'completed' }, { sequence: 2, status: 'scheduled' }], round: { sequence: 2, status: 'scheduled', groupPostMinted: false } }))).toEqual({ ok: true });
  });

  it('the event follows its rounds: the first start takes it live, the last completion completes it', () => {
    expect(eventStatusAfterRound('open', [{ status: 'live' }, { status: 'scheduled' }])).toBe('live');
    expect(eventStatusAfterRound('open', [{ status: 'scheduled' }, { status: 'scheduled' }])).toBeNull();
    expect(eventStatusAfterRound('live', [{ status: 'completed' }, { status: 'scheduled' }])).toBeNull();
    expect(eventStatusAfterRound('live', [{ status: 'completed' }, { status: 'live' }])).toBeNull();
    expect(eventStatusAfterRound('live', [{ status: 'completed' }, { status: 'completed' }])).toBe('completed');
    expect(eventStatusAfterRound('live', [{ status: 'completed' }, { status: 'cancelled' }])).toBe('completed');
    expect(eventStatusAfterRound('live', [{ status: 'cancelled' }])).toBeNull(); // nothing was ever played — never "completed"
    expect(eventStatusAfterRound('completed', [{ status: 'completed' }])).toBeNull();
    expect(eventStatusAfterRound('draft', [{ status: 'live' }])).toBeNull();
  });

  it('nextStartableRound: the lowest scheduled round with every earlier round done; null when one is live or none is left', () => {
    expect(nextStartableRound([{ sequence: 2, status: 'scheduled' }, { sequence: 1, status: 'scheduled' }])?.sequence).toBe(1);
    expect(nextStartableRound([{ sequence: 1, status: 'completed' }, { sequence: 2, status: 'cancelled' }, { sequence: 3, status: 'scheduled' }])?.sequence).toBe(3);
    expect(nextStartableRound([{ sequence: 1, status: 'live' }, { sequence: 2, status: 'scheduled' }])).toBeNull();
    expect(nextStartableRound([{ sequence: 1, status: 'completed' }])).toBeNull();
    expect(nextStartableRound([])).toBeNull();
  });

  it('the event-level completed refuses while a round is still scheduled (rounds_remaining)', () => {
    expect(validateTransition('live', 'completed', facts({ rounds: [{ scheduledOn: 'a', groupPostMinted: true, status: 'live' }, { scheduledOn: 'b', groupPostMinted: false, status: 'scheduled' }] }))).toEqual({ ok: false, reason: 'rounds_remaining' });
    expect(validateTransition('live', 'completed', facts({ rounds: [{ scheduledOn: 'a', groupPostMinted: true, status: 'live' }, { scheduledOn: 'b', groupPostMinted: false, status: 'cancelled' }] }))).toEqual({ ok: true });
    expect(TRANSITION_REFUSAL_COPY.rounds_remaining).toContain('last round');
    expect(ROUND_REFUSAL_COPY.another_round_live).toContain('Complete it');
  });
});
