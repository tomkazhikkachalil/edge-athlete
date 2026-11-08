import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * SCALE_AUDIT §6's small open rows (the performance program, Phase 5 — Nov
 * 2026): reads that could grow past PostgREST's silent 1,000-row cut now carry
 * a bound, and the handle search names a limiter bucket like every other
 * query-per-keystroke route.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the audit rows are bounded', () => {
  it("an athlete's achievements: newest first, 500 at most", () => {
    expect(read('src/app/api/achievements/route.ts')).toMatch(/\.from\('athlete_achievements'\)[\s\S]*?\.limit\(500\);/);
  });
  it("a message page's reactions: bounded by the ids it asked for", () => {
    expect(read('src/app/api/messages/[conversationId]/route.ts')).toMatch(/\.from\('message_reactions'\)[\s\S]*?\.in\('message_id', messageIds\)[\s\S]*?\.limit\(messageIds\.length \* 24\)/);
  });
  it('the calendar overlay: every posts read bounded (the id list, or the range cap)', () => {
    const src = read('src/lib/calendar/activity-overlay.ts');
    expect(src).toContain('export const OVERLAY_ROWS_MAX = 1000;');
    expect(src).toMatch(/\.or\(filters\.join\(','\)\)[\s\S]*?\.limit\(\(roundIds\.length \+ groupPostIds\.length\) \* 4 \+ 50\)/);
    expect(src.match(/\.limit\(OVERLAY_ROWS_MAX\)/g)).toHaveLength(2);
  });
  it("an org's seasons and teams: 500 at most each", () => {
    const src = read('src/lib/orgs/structure-server.ts');
    expect(src.match(/\.limit\(500\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('the handle search spends a bucket: the viewer\'s people-search, or the IP\'s handle-check for an anonymous caller', () => {
    const src = read('src/app/api/handles/search/route.ts');
    expect(src).toContain("enforceRateLimit(request, 'people-search', { userId: viewerId })");
    expect(src).toContain("enforceRateLimit(request, 'handle-check')");
    expect(src).toMatch(/if \(limited\) return limited;/);
  });
});
