import { describe, expect, it } from 'vitest';
import { recordingModeOf, selfEntryFor } from '../recording';

describe('recordingModeOf — derived from self_entry + the named recorders, never stored', () => {
  it('self when players enter their own and nobody is named; both once a recorder is named; recorder when self entry is off', () => {
    expect(recordingModeOf({ self_entry: true }, [])).toBe('self');
    expect(recordingModeOf({ self_entry: true }, [{ recorder: true, status: 'accepted' }])).toBe('both');
    expect(recordingModeOf({ self_entry: false }, [])).toBe('recorder');
    expect(recordingModeOf({ self_entry: false }, [{ recorder: true, status: 'accepted' }])).toBe('recorder');
  });
  it('a recorder who is no longer in the event does not count', () => {
    expect(recordingModeOf({ self_entry: true }, [{ recorder: true, status: 'removed' }, { recorder: true, status: 'invited' }])).toBe('self');
  });
  it('the wizard choice maps to the one fact', () => {
    expect(selfEntryFor('self')).toBe(true);
    expect(selfEntryFor('both')).toBe(true);
    expect(selfEntryFor('recorder')).toBe(false);
  });
});
