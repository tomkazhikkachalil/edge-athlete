import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EXPORT_SECTIONS, EXPORT_ROW_CAP, buildExportBundle, exportFilename } from '../account-export';
import { PROFILE_FK_POLICY } from '../account-departure';

describe('the account export (Nov 2 2026)', () => {
  it('every section is a table.column the departure policy classifies — the live FK set, by the policy test', () => {
    for (const s of EXPORT_SECTIONS) {
      expect(PROFILE_FK_POLICY[`${s.table}.${s.column}`], `${s.table}.${s.column}`).toBeDefined();
    }
  });

  it('section keys are unique, and the tokens, access rows and safety machinery stay out', () => {
    const keys = EXPORT_SECTIONS.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const tables = new Set(EXPORT_SECTIONS.map(s => s.table));
    for (const out of ['calendar_feed_tokens', 'profile_access', 'push_subscriptions', 'risk_signals', 'message_reports', 'user_blocks', 'user_mutes', 'platform_admins']) {
      expect(tables.has(out), out).toBe(false);
    }
    // Only the account's OWN rows: never a column that names someone else's thing about them.
    expect(EXPORT_SECTIONS.find(s => s.table === 'notifications')).toBeUndefined();
  });

  it('the file carries the cap and names a cut section; a missing table is null, never an error', () => {
    const now = new Date('2026-11-02T12:00:00Z');
    const big = Array.from({ length: EXPORT_ROW_CAP + 1 }, (_, i) => ({ id: i }));
    const bundle = buildExportBundle({ userId: 'u1', email: 'a@b.c', profile: { id: 'u1' }, now }, { posts: big, comments: [{ id: 'c' }], likes: null });
    expect(bundle.format).toBe('edge-athlete-export/1');
    expect(bundle.exported_at).toBe('2026-11-02T12:00:00.000Z');
    expect(bundle.account).toEqual({ id: 'u1', email: 'a@b.c' });
    expect(bundle.data.posts).toHaveLength(EXPORT_ROW_CAP);
    expect(bundle.truncated).toEqual(['posts']);
    expect(bundle.data.comments).toEqual([{ id: 'c' }]);
    expect(bundle.data.likes).toBeNull();
    // a section the route never read is present and null — the reader sees every key
    expect(Object.keys(bundle.data)).toEqual(EXPORT_SECTIONS.map(s => s.key));
    expect(bundle.data.golf_rounds).toBeNull();
    expect(exportFilename(now)).toBe('edge-athlete-export-2026-11-02.json');
  });

  it('the rule imports nothing; the route reads ONLY eq(column, userId) through the admin client', () => {
    const rule = fs.readFileSync(path.join(process.cwd(), 'src/lib/account-export.ts'), 'utf8');
    expect(rule).not.toMatch(/^import /m);
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/account/export/route.ts'), 'utf8');
    expect(route).toContain("requireAuth(request, { limit: 'account-export' })");
    expect(route).toContain('.eq(section.column, user.id)');
    expect(route).toContain("'Cache-Control': 'private, no-store'");
    expect(route).toContain('Content-Disposition');
  });
});
