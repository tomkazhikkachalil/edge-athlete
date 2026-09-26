import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { projectAuthorityEntry, type StoredAuthorityEntry } from '../authority/projection';
import { NO_INTAKE_TARGETS } from '../tickets/server';
import { severityFor } from '../tickets/severity';
import { HELP_CATEGORIES, isReasonForType } from '../tickets/types';

// Authority PR 5 (Sep 25 2026): report an org or event, the recovery request,
// soft-deleted news, and the owner's Activity. Pinned here: the owner's
// projection never names the Edge Athlete admin, the ticket or the team's
// note; an org / event report is never acted on at intake and never counts
// against a person; every news reader skips deleted posts.

const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('the owner’s view of the authority log', () => {
  const names = new Map([['m1', 'Pat Member'], ['t1', 'Sam Target'], ['admin1', 'Alex Admin']]);
  const row = (over: Partial<StoredAuthorityEntry>): StoredAuthorityEntry => ({
    id: 'a1', action: 'owner_removed', actor_kind: 'member', actor_profile_id: 'm1', target_profile_id: 't1', ticket_id: null, detail: {}, created_at: '2026-09-25T10:00:00Z', ...over,
  });

  it('an act by the team reads "Edge Athlete support" — never the admin, the ticket or the note', () => {
    const out = projectAuthorityEntry(row({ actor_kind: 'platform', actor_profile_id: 'admin1', ticket_id: 'tk1', detail: { note: 'verified by phone with the secretary', title: 'Opening day' } }), names);
    expect(out.actor).toBe('Edge Athlete support');
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/Alex Admin|admin1|tk1|ticket|secretary|note/);
    expect(out.detail.title).toBe('Opening day');
  });

  it('a member’s act names them; a system act is automatic; a gone person is a former member', () => {
    expect(projectAuthorityEntry(row({}), names)).toMatchObject({ actor: 'Pat Member', target: 'Sam Target', words: 'Removed an owner' });
    expect(projectAuthorityEntry(row({ actor_kind: 'system', actor_profile_id: null }), names).actor).toBe('Automatic');
    expect(projectAuthorityEntry(row({ actor_profile_id: 'gone', target_profile_id: 'gone2' }), names)).toMatchObject({ actor: 'A former member', target: 'A former member' });
  });

  it('the detail keeps only what the owner can act on', () => {
    const out = projectAuthorityEntry(row({ action: 'news_deleted', detail: { news_id: 'n1', title: 'T', before: { name: 'Old' }, invite_id: 'i', expires_at: 'x', from_profile_id: 'p' } }), names);
    expect(out.detail).toEqual({ title: 'T', newsId: 'n1' });
  });

  it('the log reader never looks up a platform actor’s name', () => {
    const src = read('src/lib/authority/log-server.ts');
    expect(src).toMatch(/r\.actor_kind === 'member' \? r\.actor_profile_id : null/);
    expect(src).not.toMatch(/ticket_id/);
  });

  it('the Activity route is owner-only', () => {
    expect(read('src/lib/orgs/routes/authority-log.ts')).toMatch(/requireOrgManager\(admin, user, kind, params\.id, \{ intent: 'change_roles' \}\)/);
  });
});

describe('reporting an org or event', () => {
  it('is never acted on at intake — the team decides in the recovery panel', () => {
    expect([...NO_INTAKE_TARGETS].sort()).toEqual(['org', 'sport_event']);
    expect(read('src/lib/tickets/server.ts')).toMatch(/!NO_INTAKE_TARGETS\.has\(input\.target\.type\)\) \{\s*const \{ applyIntake \}/);
    expect(read('src/app/api/admin/tickets/[id]/actions/route.ts')).toMatch(/t\.target_type === 'org' \|\| t\.target_type === 'sport_event'/);
  });

  it('never counts against a person: both resolvers answer profileId null', () => {
    const src = read('src/lib/tickets/snapshot-server.ts');
    for (const fn of ['resolveOrg', 'resolveSportEvent']) {
      const body = src.split(`async function ${fn}(`)[1]?.split('\nasync function ')[0] ?? '';
      expect(body, fn).toMatch(/profileId: null,/);
      expect(body, fn).toMatch(/return null; \/\/ your own/);
    }
  });
});

describe('the recovery request', () => {
  it('is a Help category at HIGH severity', () => {
    expect(HELP_CATEGORIES).toContain('recovery');
    expect(isReasonForType('help', 'recovery')).toBe(true);
    expect(severityFor({ type: 'help', reason: 'recovery', targetIsMinor: false })).toBe('high');
    expect(severityFor({ type: 'help', reason: 'account', targetIsMinor: false })).toBe('medium');
  });

  it('both ticket doors resolve the reference the same way (the same 201 whatever it finds)', () => {
    expect(read('src/app/api/tickets/route.ts')).toMatch(/recoveryTicketFields\(admin, body\.reference, description\)/);
    expect(read('src/app/api/tickets/guest/route.ts')).toMatch(/recoveryTicketFields\(admin, b\.reference, b\.description\)/);
  });
});

describe('soft-deleted news', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(p, out); }
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  }
  // Reads that are NOT visitor/manager lists: the delete route reads the doomed title for its log line.
  const EXEMPT = new Set(['src/lib/orgs/routes/site-news-item.ts']);

  it('every READ of org_site_news names deleted_at (skips deleted rows, or lists them on purpose)', () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, file);
      if (EXEMPT.has(rel)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const parts = text.split(/from\(['"]org_site_news['"]\)/).slice(1);
      parts.forEach((chain, i) => {
        const head = chain.slice(0, 600).split(/;\s*\n/)[0];
        if (/^\s*\.(insert|update|delete)\(/.test(head)) {
          // A writer: an update or delete must still fence on deleted_at (none may touch a deleted row by accident)
          // — except the purge and the restore, which name it too.
          if (/^\s*\.(update|delete)\(/.test(head) && !/deleted_at/.test(head)) offenders.push(`${rel}#${i} writer`);
          return;
        }
        if (!/deleted_at/.test(head)) offenders.push(`${rel}#${i}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the daily cron purges after the restore window', () => {
    expect(read('src/app/api/cron/daily/route.ts')).toMatch(/summary\.deletedNews = await purgeDeletedNews\(admin\)/);
  });
});
