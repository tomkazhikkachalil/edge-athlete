import { describe, expect, it } from 'vitest';
import { buildSiteFeed } from '../schedule-feed';
import type { OrgEvent } from '@/lib/calendar/org-events-server';

const event: OrgEvent = {
  id: 'evt-1',
  title: 'Clubhouse social',
  description: null,
  location: 'Clubhouse',
  starts_at: '2026-09-10T22:00:00.000Z',
  ends_at: '2026-09-11T00:00:00.000Z',
  all_day: false,
  timezone: 'America/Toronto',
  category: 'social',
  venue_id: null,
  facility_id: null,
};

describe('buildSiteFeed — the site’s public ICS', () => {
  it('rounds become all-day VALUE=DATE events with an exclusive end; mirrored rounds are not duplicated', () => {
    const ics = buildSiteFeed({
      name: 'QA Links',
      events: [event],
      rounds: [
        { id: 'c1', competitionName: 'Thursday Nine', round: 'Week 1', holes: 9, playFrom: '2026-09-01', playTo: '2026-09-07', courseName: 'QA Nine', eventId: null },
        // Mirrored AND carried as an event → not duplicated.
        { id: 'c2', competitionName: 'Thursday Nine', round: 'Week 2', holes: 9, playFrom: '2026-09-08', playTo: '2026-09-14', courseName: 'QA Nine', eventId: 'evt-1' },
        // Mirrored but its event is NOT in the feed (it started days ago) → carried as a round.
        { id: 'c3', competitionName: 'Thursday Nine', round: 'Week 0', holes: 9, playFrom: '2026-08-25', playTo: '2026-08-31', courseName: 'QA Nine', eventId: 'evt-old' },
      ],
      dtstampMs: Date.UTC(2026, 8, 2, 12),
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('X-WR-CALNAME:QA Links');
    expect(ics).toContain('UID:event-evt-1@edge-athlete');
    expect(ics).toContain('SUMMARY:Clubhouse social');
    expect(ics).toContain('UID:contest-c1@edge-athlete');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260901');
    expect(ics).toContain('DTEND;VALUE=DATE:20260908');
    expect(ics).toContain('SUMMARY:Week 1 — Thursday Nine');
    expect(ics).toContain('LOCATION:QA Nine');
    expect(ics).not.toContain('contest-c2@');
    expect(ics).toContain('UID:contest-c3@edge-athlete');
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
  });
  it('an empty site still yields a valid calendar', () => {
    const ics = buildSiteFeed({ name: 'Empty', events: [], rounds: [], dtstampMs: 0 });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});
