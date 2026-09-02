import { describe, expect, it } from 'vitest';
import { buildAnnouncementRows, OrgAnnounceSchema } from '../announce';

describe('OrgAnnounceSchema', () => {
  it('bounds the title and message; the site date must be a day', () => {
    expect(OrgAnnounceSchema.safeParse({ title: 'Rain-out', message: 'Week 3 runs to Sunday.' }).success).toBe(true);
    expect(OrgAnnounceSchema.safeParse({ title: '', message: 'x' }).success).toBe(false);
    expect(OrgAnnounceSchema.safeParse({ title: 'x'.repeat(81), message: 'x' }).success).toBe(false);
    expect(OrgAnnounceSchema.safeParse({ title: 'x', message: 'x'.repeat(501) }).success).toBe(false);
    expect(OrgAnnounceSchema.safeParse({ title: 'x', message: 'x', siteNoticeUntil: 'Sunday' }).success).toBe(false);
    expect(OrgAnnounceSchema.safeParse({ title: 'x', message: 'x', siteNoticeUntil: '2026-09-07' }).success).toBe(true);
  });
});

describe('buildAnnouncementRows', () => {
  const ctx = {
    side: 'league' as const,
    orgId: 'org-1',
    orgName: 'Thursday Nine',
    title: 'Rain-out',
    message: 'Week 3 runs to Sunday.',
    actorId: 'manager',
    announcementId: 'ann-1',
  };
  it('one row per member, the actor excluded, duplicates collapsed, the org type and a self-contained title', () => {
    const rows = buildAnnouncementRows(['a', 'manager', 'b', 'a', ''], ctx);
    expect(rows.map(r => r.user_id)).toEqual(['a', 'b']);
    expect(rows[0]).toEqual({
      user_id: 'a',
      type: 'league_update',
      actor_id: 'manager',
      title: 'Thursday Nine: Rain-out',
      message: 'Week 3 runs to Sunday.',
      action_url: '/league/org-1',
      is_read: false,
      metadata: { org: 'league:org-1', announcement_id: 'ann-1', announcement: true },
    });
  });
  it('a club announces as club_update', () => {
    expect(buildAnnouncementRows(['a'], { ...ctx, side: 'club' })[0].type).toBe('club_update');
    expect(buildAnnouncementRows(['a'], { ...ctx, side: 'club' })[0].action_url).toBe('/club/org-1');
  });
});
