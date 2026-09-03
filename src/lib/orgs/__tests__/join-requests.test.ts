import { describe, expect, it } from 'vitest';

// Phase 9 V2 (both sides in program 11) — the join-request bells' copy and
// the queue's table by side.
import { joinDecisionMessage, joinDecisionTitle, joinRequestTitle, joinRequestsTable } from '../join-requests';

describe('join request titles', () => {
  it('asks the managers, and tells the requester the decision', () => {
    expect(joinRequestTitle('Alex', 'Eagle Creek')).toBe('Alex asked to join Eagle Creek');
    expect(joinDecisionTitle('Eagle Creek', true)).toBe("You're now a member of Eagle Creek");
    expect(joinDecisionTitle('Eagle Creek', false)).toBe('Your request to join Eagle Creek was declined');
  });

  it('welcomes by side; a decline carries no message', () => {
    expect(joinDecisionMessage('club', true)).toMatch(/club page and its leagues/);
    expect(joinDecisionMessage('league', true)).toMatch(/league page, its standings/);
    expect(joinDecisionMessage('club', false)).toBeNull();
    expect(joinDecisionMessage('league', false)).toBeNull();
  });
});

describe('joinRequestsTable', () => {
  it('picks the side\'s queue (176 clubs, 177 leagues)', () => {
    expect(joinRequestsTable('club')).toBe('club_join_requests');
    expect(joinRequestsTable('league')).toBe('league_join_requests');
  });
});
