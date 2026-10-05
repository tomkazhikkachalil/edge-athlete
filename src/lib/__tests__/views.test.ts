import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseViewItems, viewSalt, viewerMark, VIEW_KINDS } from '../views/hash';
import { compactCount, countLabel } from '../views/format';
import { createViewQueue, viewKey, FLUSH_AT, FLUSH_AFTER_MS } from '../views/client';
import { pruneCutoff } from '../views/server';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('impact — the mark', () => {
  it('a session is marked by user id, anonymous by ip + ua; the same viewer on the same day is one mark', () => {
    const u1 = viewerMark('salt', '2026-10-04', { userId: 'u-1' });
    expect(u1).toBe(viewerMark('salt', '2026-10-04', { userId: 'u-1' }));
    expect(u1).not.toBe(viewerMark('salt', '2026-10-05', { userId: 'u-1' })); // unlinkable across days
    expect(u1).not.toBe(viewerMark('salt', '2026-10-04', { userId: 'u-2' }));
    const anon = viewerMark('salt', '2026-10-04', { ip: '1.2.3.4', ua: 'Safari' });
    expect(anon).toBe(viewerMark('salt', '2026-10-04', { ip: '1.2.3.4', ua: 'Safari' }));
    expect(anon).not.toBe(viewerMark('salt', '2026-10-04', { ip: '1.2.3.5', ua: 'Safari' }));
    expect(u1).toMatch(/^[0-9a-f]{32}$/);
    expect(u1).not.toContain('u-1');
  });

  it('no salt → nothing is counted; the analytics salt wins over the HMAC family', () => {
    expect(viewSalt({})).toBeNull();
    expect(viewSalt({ MEDIA_PROXY_SECRET: 'm' })).toBe('m');
    expect(viewSalt({ ANALYTICS_SALT: 'a', MEDIA_PROXY_SECRET: 'm' })).toBe('a');
  });

  it('the body: ≤ 50 (uuid, kind) pairs, duplicates folded, junk refused', () => {
    expect(parseViewItems({ items: [{ id: A, kind: 'view' }, { id: A, kind: 'view' }, { id: A, kind: 'play' }] })).toEqual([
      { id: A, kind: 'view' }, { id: A, kind: 'play' },
    ]);
    expect(parseViewItems({ items: [] })).toBeNull();
    expect(parseViewItems({ items: [{ id: 'nope', kind: 'view' }] })).toBeNull();
    expect(parseViewItems({ items: [{ id: A, kind: 'watch' }] })).toBeNull();
    expect(parseViewItems({ items: Array.from({ length: 51 }, () => ({ id: A, kind: 'view' })) })).toBeNull();
    expect(parseViewItems(null)).toBeNull();
    expect(VIEW_KINDS).toEqual(['view', 'play']);
  });

  it('the kind CHECK in 252 names exactly the catalog', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'database/migrations/252_post_views.sql'), 'utf8');
    const m = sql.match(/post_view_marks_kind_check CHECK \(kind IN \(([^)]*)\)\)/);
    expect(m).not.toBeNull();
    const kinds = m![1].split(',').map(s => s.trim().replace(/'/g, ''));
    expect(kinds).toEqual([...VIEW_KINDS]);
    expect(sql).toMatch(/INSERT INTO public\.schema_migrations \(number, name\) VALUES \(252, '252_post_views\.sql'\) ON CONFLICT \(number\) DO NOTHING;/);
  });

  it('marks older than two days are pruned', () => {
    expect(pruneCutoff(new Date('2026-10-04T14:00:00Z'))).toBe('2026-10-02');
  });
});

describe('impact — the number on the card', () => {
  it('compactCount', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1000)).toBe('1K');
    expect(compactCount(1234)).toBe('1.2K');
    expect(compactCount(12_345)).toBe('12K');
    expect(compactCount(3_400_000)).toBe('3.4M');
    expect(compactCount(-5)).toBe('0');
    expect(compactCount(undefined)).toBe('0');
  });
  it('countLabel', () => {
    expect(countLabel(1, 'view')).toBe('1 view');
    expect(countLabel(12, 'view')).toBe('12 views');
    expect(countLabel(1200, 'play')).toBe('1.2K plays');
  });
});

describe('impact — the client queue', () => {
  it('one (post, kind) per day; flushes after the delay or at the cap; pagehide-style flush empties it', () => {
    const sent: { id: string; kind: 'view' | 'play' }[][] = [];
    const timers: (() => void)[] = [];
    let day = new Date('2026-10-04T10:00:00Z');
    const q = createViewQueue(items => sent.push(items), fn => { timers.push(fn); return 1; }, () => day);
    expect(q.record(A, 'view')).toBe(true);
    expect(q.record(A, 'view')).toBe(false); // the same tab, the same day
    expect(q.record(A, 'play')).toBe(true);
    expect(q.pendingCount()).toBe(2);
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(sent).toEqual([[{ id: A, kind: 'view' }, { id: A, kind: 'play' }]]);
    expect(q.pendingCount()).toBe(0);
    // A new day is a new view.
    day = new Date('2026-10-05T10:00:00Z');
    expect(q.record(A, 'view')).toBe(true);
    q.flush();
    expect(sent).toHaveLength(2);
    // The cap flushes at once.
    for (let i = 0; i < FLUSH_AT; i++) q.record(`${B.slice(0, 35)}${i.toString().padStart(1, '0')}`.slice(0, 36), 'view');
    expect(q.pendingCount()).toBeLessThan(FLUSH_AT);
    expect(viewKey(A, 'view', '2026-10-04')).toBe(`${A}:view:2026-10-04`);
    expect(FLUSH_AFTER_MS).toBe(2000);
  });
});
