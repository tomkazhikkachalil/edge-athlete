import { describe, expect, it } from 'vitest';
import { planCardAction } from '../cards';
import { holeRangeFor } from '../scoring-authz';

const owner = { isOwner: true, canManage: false };
const org = { isOwner: false, canManage: true };
const other = { isOwner: false, canManage: false };

describe('planCardAction', () => {
  it('submit: the owner only; in_progress → submitted (+ scores_confirmed); submitted is a no-op; final is closed', () => {
    expect(planCardAction('submit', 'in_progress', owner)).toEqual({ ok: true, changed: true, next: { status: 'submitted', submitted_at: 'now', finalized_by: null, scores_confirmed: true } });
    expect(planCardAction('submit', 'submitted', owner)).toMatchObject({ ok: true, changed: false });
    expect(planCardAction('submit', 'final', owner)).toMatchObject({ ok: false, status: 409 });
    expect(planCardAction('submit', 'in_progress', org)).toMatchObject({ ok: false, status: 403 });
  });
  it('finalize: organizers only; any → final, keeping a real submitted_at; final is a no-op', () => {
    expect(planCardAction('finalize', 'in_progress', org)).toEqual({ ok: true, changed: true, next: { status: 'final', submitted_at: 'now', finalized_by: 'actor' } });
    expect(planCardAction('finalize', 'submitted', org)).toEqual({ ok: true, changed: true, next: { status: 'final', submitted_at: 'keep', finalized_by: 'actor' } });
    expect(planCardAction('finalize', 'final', org)).toMatchObject({ ok: true, changed: false });
    expect(planCardAction('finalize', 'in_progress', owner)).toMatchObject({ ok: false, status: 403 });
  });
  it('reopen: organizers only; submitted | final → in_progress; an open card is refused', () => {
    expect(planCardAction('reopen', 'final', org)).toEqual({ ok: true, changed: true, next: { status: 'in_progress', submitted_at: null, finalized_by: null } });
    expect(planCardAction('reopen', 'submitted', org)).toMatchObject({ ok: true, next: { status: 'in_progress' } });
    expect(planCardAction('reopen', 'in_progress', org)).toMatchObject({ ok: false, status: 409 });
    expect(planCardAction('reopen', 'final', other)).toMatchObject({ ok: false, status: 403 });
  });
});

describe('holeRangeFor', () => {
  it('an event round answers its own start and length; a plain round derives from hole data; nothing → 1..18', () => {
    expect(holeRangeFor({ eventRound: { starting_hole: 10, holes: 9 }, derivedStartingHole: 1, holesPlayed: 9 })).toEqual({ startingHole: 10, holesPlayed: 9 });
    expect(holeRangeFor({ eventRound: null, derivedStartingHole: 10, holesPlayed: 9 })).toEqual({ startingHole: 10, holesPlayed: 9 });
    expect(holeRangeFor({ eventRound: null, derivedStartingHole: 1, holesPlayed: null })).toEqual({ startingHole: 1, holesPlayed: 18 });
  });
});
