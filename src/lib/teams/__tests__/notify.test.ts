import { describe, expect, it } from 'vitest';
import { teamRosterCopy } from '../notify';

describe('teamRosterCopy', () => {
  it("speaks to the player, and names the child to a guardian", () => {
    expect(teamRosterCopy({ kind: 'added', teamName: 'Blazers' }, 'North Club').title).toBe('You were added to Blazers at North Club');
    expect(teamRosterCopy({ kind: 'added', teamName: 'Blazers' }, 'North Club', 'Sam').title).toBe('Sam was added to Blazers at North Club');
    expect(teamRosterCopy({ kind: 'moved', fromName: 'Blazers', teamName: 'Comets' }, 'North Club').title).toBe('You moved from Blazers to Comets at North Club');
    expect(teamRosterCopy({ kind: 'removed', teamName: 'Blazers' }, 'North Club', 'Sam').title).toBe('Sam was taken off Blazers at North Club');
    expect(teamRosterCopy({ kind: 'carried', teamName: 'Blazers', seasonLabel: '2027' }, 'North Club').title).toBe('You are on Blazers again for 2027 at North Club');
  });
  it('a removal says results stay on the record', () => {
    expect(teamRosterCopy({ kind: 'removed', teamName: 'Blazers' }, 'North Club').message).toContain('Past results stay on the record');
  });
});
