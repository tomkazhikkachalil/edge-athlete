import { describe, expect, it } from 'vitest';
import { planRoundReminders, reminderCopy } from '../reminders';

describe('reminderCopy — "Tomorrow: …" to the schedule', () => {
  it('names the event, the round on a tournament, the day, the round\'s name and the course', () => {
    const c = reminderCopy({ id: 'e1', name: 'Spring Open' }, { sequence: 2, scheduled_on: '2030-06-01', course_name: 'QA Links', name: 'Final' }, 3);
    expect(c.type).toBe('sport_event_reminder');
    expect(c.title).toBe('Tomorrow: Spring Open · Round 2 of 3');
    expect(c.message).toContain('Jun 1');
    expect(c.message).toContain('Final · QA Links');
    expect(c.action_url).toBe('/events/e1?tab=schedule');
    expect(reminderCopy({ id: 'e1', name: 'Spring Open' }, { sequence: 1, scheduled_on: '2030-06-01', course_name: 'QA Links' }, 1).title).toBe('Tomorrow: Spring Open');
    // Leftovers PR 8: the venue time when the round has a start and a zone.
    expect(reminderCopy({ id: 'e1', name: 'Cup' }, { sequence: 1, scheduled_on: '2030-06-01', course_name: 'Rink', starts_at: '2030-06-02T05:00:00.000Z', timezone: 'Pacific/Honolulu' }, 1).message).toBe('Sat, Jun 1, 2030 · Rink · 7:00 PM HST');
    expect(reminderCopy({ id: 'e1', name: 'Cup' }, { sequence: 1, scheduled_on: '2030-06-01', course_name: 'Rink', starts_at: '2030-06-02T05:00:00.000Z' }, 1).message).toBe('Sat, Jun 1, 2030 · Rink');
  });
});

describe('planRoundReminders — accepted players and followers, once', () => {
  it('skips invited / waitlisted / declined rows, the already-belled and duplicates', () => {
    const out = planRoundReminders([
      { profile_id: 'a', status: 'accepted' },
      { profile_id: 'b', status: 'accepted' },
      { profile_id: 'c', status: 'invited' },
      { profile_id: 'd', status: 'waitlisted' },
      { profile_id: 'e', status: 'declined' },
      { profile_id: 'a', status: 'accepted' },
    ], new Set(['b']));
    expect(out).toEqual(['a']);
    expect(planRoundReminders([], new Set())).toEqual([]);
  });
});
