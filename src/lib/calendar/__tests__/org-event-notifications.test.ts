import { describe, it, expect } from 'vitest';
import { buildOrgEventNotificationRows } from '../org-event-notifications';

const TEMPLATE = {
  title: 'Spring League scheduled: Round 3',
  message: 'Sat, Aug 29 · 9:00 AM',
  actorId: 'organizer-1',
  actionUrl: '/calendar?event=ev-1',
  metadata: { event_id: 'ev-1', org: 'league:l-1', team_event: 'scheduled' },
};

describe('buildOrgEventNotificationRows', () => {
  it('shapes one team_update row per member', () => {
    const rows = buildOrgEventNotificationRows(['m1', 'm2'], new Set(), TEMPLATE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      user_id: 'm1',
      type: 'team_update',
      actor_id: 'organizer-1',
      title: TEMPLATE.title,
      message: TEMPLATE.message,
      action_url: TEMPLATE.actionUrl,
      is_read: false,
      metadata: TEMPLATE.metadata,
    });
  });

  it('dedupes member ids', () => {
    const rows = buildOrgEventNotificationRows(['m1', 'm1', 'm2'], new Set(), TEMPLATE);
    expect(rows.map(r => r.user_id)).toEqual(['m1', 'm2']);
  });

  it('drops excluded ids — organizer and already-notified guests', () => {
    const rows = buildOrgEventNotificationRows(
      ['organizer-1', 'guest-1', 'm2'],
      new Set(['organizer-1', 'guest-1']),
      TEMPLATE
    );
    expect(rows.map(r => r.user_id)).toEqual(['m2']);
  });

  it('drops falsy ids and returns [] when nobody remains', () => {
    expect(buildOrgEventNotificationRows(['', 'organizer-1'], new Set(['organizer-1']), TEMPLATE)).toEqual([]);
  });
});
