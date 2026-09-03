import { describe, expect, it } from 'vitest';

// Phase 9 V2 — the join-request bells' copy.
import { joinDecisionTitle, joinRequestTitle } from '../notify';

describe('join request titles (V2)', () => {
  it('asks the managers, and tells the requester the decision', () => {
    expect(joinRequestTitle('Alex', 'Eagle Creek')).toBe('Alex asked to join Eagle Creek');
    expect(joinDecisionTitle('Eagle Creek', true)).toBe("You're now a member of Eagle Creek");
    expect(joinDecisionTitle('Eagle Creek', false)).toBe('Your request to join Eagle Creek was declined');
  });
});
