import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AUTHORITY_ACTIONS } from '../authority/types';
import { AuthorityRowError, buildAuthorityRow, sanitizeDetail } from '../authority/audit';

// Authority (migration 240, Sep 25 2026): one append-only record of who
// changed who can run a club, league or event. Pinned here: the vocabulary
// equals the database's CHECK, the table carries NO foreign keys (the
// append-only trigger vs ON DELETE SET NULL — the 056 lesson), the detail is
// sanitized, there is ONE writer, and every authority writer calls it.

const ROOT = process.cwd();
const MIGRATION = fs.readFileSync(path.join(ROOT, 'database/migrations/240_authority.sql'), 'utf8');
const SQL = MIGRATION.replace(/--[^\n]*/g, '');

describe('240 and the vocabulary', () => {
  it('AUTHORITY_ACTIONS is exactly the CHECK list', () => {
    const block = /authority_audit_action_check CHECK \(action IN \(([\s\S]*?)\)\)/.exec(SQL);
    expect(block, 'the action CHECK').toBeTruthy();
    const inFile = [...block![1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    expect([...inFile].sort()).toEqual([...AUTHORITY_ACTIONS].sort());
  });

  it('the audit table carries NO foreign keys (the append-only trigger would refuse ON DELETE SET NULL)', () => {
    const table = /CREATE TABLE IF NOT EXISTS public\.authority_audit \(([\s\S]*?)\n\);/.exec(SQL);
    expect(table, 'the CREATE TABLE block').toBeTruthy();
    expect(table![1]).not.toMatch(/REFERENCES/i);
    expect(SQL).toMatch(/CREATE TRIGGER authority_audit_immutable\s+BEFORE UPDATE OR DELETE ON public\.authority_audit\s+FOR EACH ROW EXECUTE FUNCTION forbid_mutation\(\);/);
  });

  it('builds in the SQL editor\'s one transaction and records itself', () => {
    expect(SQL).not.toMatch(/CONCURRENTLY/);
    expect(SQL).toMatch(/INSERT INTO public\.schema_migrations \(number, name\) VALUES \(240, '240_authority\.sql'\) ON CONFLICT \(number\) DO NOTHING;/);
    expect(SQL).toMatch(/ADD CONSTRAINT org_sites_held_shape CHECK \(held_at IS NULL OR published_at IS NULL\)/);
  });
});

describe('buildAuthorityRow', () => {
  const org = { type: 'org' as const, id: 'o1' };

  it('a member act carries its actor', () => {
    const row = buildAuthorityRow({ subject: org, actor: { kind: 'member', profileId: 'p1' }, action: 'owner_added', targetProfileId: 'p2' });
    expect(row).toMatchObject({ subject_type: 'org', subject_id: 'o1', actor_kind: 'member', actor_profile_id: 'p1', target_profile_id: 'p2', ticket_id: null });
  });

  it('a system act has no actor id', () => {
    expect(buildAuthorityRow({ subject: org, actor: { kind: 'system' }, action: 'staff_revoked' }).actor_profile_id).toBeNull();
  });

  it('a platform act without its ticket is refused before the round trip', () => {
    expect(() => buildAuthorityRow({ subject: org, actor: { kind: 'platform', profileId: 'a1' }, action: 'site_held' })).toThrow(AuthorityRowError);
    expect(buildAuthorityRow({ subject: org, actor: { kind: 'platform', profileId: 'a1' }, action: 'site_held', ticketId: 't1' }).ticket_id).toBe('t1');
  });
});

describe('sanitizeDetail', () => {
  it('keeps only allowlisted keys', () => {
    expect(sanitizeDetail({ fields: ['name'], secret_plan: 'x', whatever: 1 })).toEqual({ fields: ['name'] });
  });

  it('drops anything that names an email, phone or token — at any depth', () => {
    const out = sanitizeDetail({ before: { name: 'A', email: 'a@b.c', contact: { phone: '1', note: 'ok' } }, after: { token: 'x', name: 'B' } });
    expect(out).toEqual({ before: { name: 'A', contact: { note: 'ok' } }, after: { name: 'B' } });
    expect(JSON.stringify(out)).not.toMatch(/@|token|phone/);
  });

  it('caps long strings and long arrays', () => {
    const out = sanitizeDetail({ note: 'x'.repeat(500), fields: Array.from({ length: 80 }, (_, i) => `f${i}`) });
    expect((out.note as string).length).toBeLessThanOrEqual(201);
    expect((out.fields as string[]).length).toBe(50);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('one writer, and every authority writer calls it', () => {
  it('only audit-server.ts inserts into authority_audit', () => {
    const writers = walk(path.join(ROOT, 'src')).filter(f => /from\(['"]authority_audit['"]\)\s*\.insert/.test(fs.readFileSync(f, 'utf8')));
    expect(writers.map(f => path.relative(ROOT, f))).toEqual(['src/lib/authority/audit-server.ts']);
  });

  // The modules that change who can run an org or an event, or its public
  // face. Each must record the change (a new such writer joins this list).
  const AUDITED_WRITERS = [
    'src/lib/orgs/owners.ts',
    'src/lib/orgs/routes/members.ts',
    'src/lib/orgs/staff-invites.ts',
    'src/lib/orgs/create.ts',
    'src/lib/orgs/routes/org.ts',
    'src/lib/orgs/routes/site-domain.ts',
    'src/lib/orgs/routes/site-news-item.ts',
    'src/lib/orgs/routes/site-pages-item.ts',
    'src/lib/org-sites/server.ts',
    'src/lib/org-sites/revisions-server.ts',
    'src/app/api/org-claim/[token]/route.ts',
    'src/app/api/sport-events/[id]/route.ts',
    'src/lib/sport-events/lifecycle-server.ts',
    // PR 2: the co-organizer roles and the one host writer (the deletion
    // engine hands events over through transferHost, so it records there).
    'src/lib/sport-events/host-transfer-server.ts',
    'src/lib/sport-events/roles-server.ts',
    'src/lib/sport-events/join-server.ts',
    // PR 4: the Edge Athlete team's recovery tools (every act a platform row on its ticket).
    'src/lib/authority/recovery-server.ts',
  ];
  it.each(AUDITED_WRITERS)('%s records through recordAuthority', file => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(text).toMatch(/import \{[^}]*\brecordAuthority\b[^}]*\} from '[^']*authority\/audit-server'/);
    expect(text).toMatch(/await recordAuthority\(/);
  });
});
