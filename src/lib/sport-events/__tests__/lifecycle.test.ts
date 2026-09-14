import { describe, expect, it } from 'vitest';
import { canTransition, TRANSITIONS, transitionStamp, validateTransition, type TransitionFacts } from '../lifecycle';

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
    expect(validateTransition('live', 'completed', facts({ cards: [{ status: 'final' }] }))).toEqual({ ok: false, reason: 'cards_not_final' }); // a player never started
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
