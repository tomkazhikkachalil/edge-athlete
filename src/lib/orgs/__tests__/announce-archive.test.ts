import { describe, expect, it } from 'vitest';
import { buildAnnouncementRows, groupAnnouncements, siteNoticeMetadata } from '../announce';

// N3 (program 10): the archive is the notification rows read back —
// grouped by announcement_id over members AND guardian copies; the
// site_notice stamp rides every row only when the band took the title.

const ctx = {
  side: 'club' as const,
  orgId: 'club-1',
  orgName: 'Pine Ridge',
  title: 'Rain-out',
  message: 'Week 3 runs through Sunday.',
  actorId: 'mgr',
  announcementId: 'a-1',
};

describe('siteNoticeMetadata + the stamp on rows', () => {
  it('stamps only when mirrored', () => {
    expect(siteNoticeMetadata(undefined)).toEqual({});
    expect(siteNoticeMetadata('2027-06-30')).toEqual({ site_notice: true, notice_until: '2027-06-30' });
    const plain = buildAnnouncementRows(['m1'], ctx)[0].metadata as Record<string, unknown>;
    expect(plain.site_notice).toBeUndefined();
    const stamped = buildAnnouncementRows(['m1'], { ...ctx, siteNoticeUntil: '2027-06-30' })[0].metadata as Record<string, unknown>;
    expect(stamped).toMatchObject({ site_notice: true, notice_until: '2027-06-30', announcement_id: 'a-1', announcement: true });
  });
});

describe('groupAnnouncements', () => {
  const row = (id: string, at: string, extra: Record<string, unknown> = {}, title = `Pine Ridge: ${id}`) => ({
    title,
    message: `msg ${id}`,
    created_at: at,
    metadata: { org: 'club:club-1', announcement_id: id, announcement: true, ...extra },
  });
  it('collapses N rows to one announcement, newest first, guardian copies counted but not titled', () => {
    const rows = [
      row('a', '2026-09-01T10:00:00Z'),
      row('a', '2026-09-01T10:00:00Z'),
      row('a', '2026-09-01T10:00:01Z', { profile_id: 'child' }, 'Pine Ridge announced for Casey: a'),
      row('b', '2026-09-02T10:00:00Z', { site_notice: true, notice_until: '2027-06-30' }),
    ];
    const out = groupAnnouncements(rows);
    expect(out.map(a => a.id)).toEqual(['b', 'a']);
    expect(out[1]).toMatchObject({ title: 'Pine Ridge: a', message: 'msg a', siteNotice: false, noticeUntil: null });
    expect(out[0]).toMatchObject({ siteNotice: true, noticeUntil: '2027-06-30' });
  });
  it('a lone guardian copy still keeps the announcement alive; junk rows are skipped; the cap holds', () => {
    const only = groupAnnouncements([row('g', '2026-09-03T10:00:00Z', { profile_id: 'child' }, 'Pine Ridge announced for Casey: g')]);
    expect(only).toHaveLength(1);
    expect(only[0].title).toBe('Pine Ridge announced for Casey: g');
    expect(groupAnnouncements([{ title: 'x', message: 'y', created_at: '2026-09-03T10:00:00Z', metadata: null }])).toEqual([]);
    expect(groupAnnouncements([{ title: 'x', message: 'y', created_at: '2026-09-03T10:00:00Z', metadata: { announcement_id: 'z' } }])).toEqual([]);
    const many = Array.from({ length: 5 }, (_, i) => row(`n${i}`, `2026-09-0${i + 1}T10:00:00Z`));
    expect(groupAnnouncements(many, 2).map(a => a.id)).toEqual(['n4', 'n3']);
  });
});
