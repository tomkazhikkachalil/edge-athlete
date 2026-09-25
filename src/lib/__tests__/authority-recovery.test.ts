import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  candidateRefusal,
  identityRestorePatch,
  parseRecoveryQuery,
  planAddOwner,
  planEventCancel,
  planEventHost,
  planRemoveOwner,
  planSetRole,
} from '../authority/recovery';
import { AUTHORITY_ACTIONS } from '../authority/types';
import { AUTHORITY_ACTION_WORDS } from '../authority/words';

// Authority PR 4 (Sep 25 2026): the Edge Athlete team's recovery tools. The
// rules are pure and pinned here; the wiring (owner-only gate, the bucket,
// every act on a ticket, the hold at every publish door) is pinned by source.

const fit = { supervised: false, departed: false, holds: true };
const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('who can be given the running of something', () => {
  it('refuses the deleted, the supervised and the moderated — and the unknown', () => {
    expect(candidateRefusal(null)?.status).toBe(404);
    expect(candidateRefusal({ ...fit, departed: true })?.error).toMatch(/deleted/);
    expect(candidateRefusal({ ...fit, supervised: true })?.error).toMatch(/supervised/i);
    expect(candidateRefusal({ ...fit, holds: false })?.error).toMatch(/limited, suspended or banned/);
    expect(candidateRefusal(fit)).toBeNull();
  });
});

describe('planAddOwner', () => {
  it('promotes a member or manager, inserts a stranger, refuses an owner', () => {
    expect(planAddOwner({ candidate: fit, currentRole: 'member' })).toEqual({ ok: true, mode: 'promote' });
    expect(planAddOwner({ candidate: fit, currentRole: 'manager' })).toEqual({ ok: true, mode: 'promote' });
    expect(planAddOwner({ candidate: fit, currentRole: null })).toEqual({ ok: true, mode: 'insert' });
    expect(planAddOwner({ candidate: fit, currentRole: 'owner' })).toMatchObject({ ok: false, status: 409 });
    expect(planAddOwner({ candidate: { ...fit, holds: false }, currentRole: 'member' })).toMatchObject({ ok: false });
  });
});

describe('planRemoveOwner', () => {
  it('never leaves an org without an owner by the team’s own hand', () => {
    expect(planRemoveOwner({ ownerIds: ['a'], targetId: 'a', replacementId: null })).toMatchObject({ ok: false, status: 409 });
    expect(planRemoveOwner({ ownerIds: ['a'], targetId: 'a', replacementId: 'b' })).toEqual({ ok: true });
    expect(planRemoveOwner({ ownerIds: ['a', 'b'], targetId: 'a', replacementId: null })).toEqual({ ok: true });
  });
  it('refuses a non-owner and a self-replacement', () => {
    expect(planRemoveOwner({ ownerIds: ['a'], targetId: 'x', replacementId: null })).toMatchObject({ status: 404 });
    expect(planRemoveOwner({ ownerIds: ['a'], targetId: 'a', replacementId: 'a' })).toMatchObject({ status: 400 });
  });
});

describe('planSetRole', () => {
  it('moves manager ↔ member; owners are the owner tools’ business', () => {
    expect(planSetRole({ currentRole: 'member', to: 'manager', candidate: fit })).toEqual({ ok: true });
    expect(planSetRole({ currentRole: 'manager', to: 'member', candidate: fit })).toEqual({ ok: true });
    expect(planSetRole({ currentRole: 'owner', to: 'member', candidate: fit })).toMatchObject({ status: 409 });
    expect(planSetRole({ currentRole: null, to: 'member', candidate: fit })).toMatchObject({ status: 404 });
    expect(planSetRole({ currentRole: 'manager', to: 'manager', candidate: fit })).toMatchObject({ status: 409 });
  });
  it('a moderated member is never made a manager, but a moderated manager can always be demoted', () => {
    expect(planSetRole({ currentRole: 'member', to: 'manager', candidate: { ...fit, holds: false } })).toMatchObject({ ok: false });
    expect(planSetRole({ currentRole: 'manager', to: 'member', candidate: { ...fit, holds: false } })).toEqual({ ok: true });
  });
});

describe('events', () => {
  it('re-host: a supervised profile MAY host (convention 17); the deleted and moderated may not', () => {
    const base = { eventStatus: 'live' as const, currentHostId: 'h', targetId: 'n' };
    expect(planEventHost({ ...base, candidate: { ...fit, supervised: true } })).toEqual({ ok: true });
    expect(planEventHost({ ...base, candidate: { ...fit, departed: true } })).toMatchObject({ ok: false });
    expect(planEventHost({ ...base, candidate: { ...fit, holds: false } })).toMatchObject({ ok: false });
    expect(planEventHost({ ...base, targetId: 'h', candidate: fit })).toMatchObject({ status: 409 });
    expect(planEventHost({ ...base, eventStatus: 'cancelled', candidate: fit })).toMatchObject({ status: 409 });
  });
  it('cancel only before it starts; a live event is made private or re-hosted instead', () => {
    expect(planEventCancel('draft')).toEqual({ ok: true });
    expect(planEventCancel('open')).toEqual({ ok: true });
    expect(planEventCancel('live')).toMatchObject({ ok: false, error: expect.stringMatching(/private or re-host/) });
    expect(planEventCancel('completed')).toMatchObject({ ok: false });
    expect(planEventCancel('cancelled')).toMatchObject({ ok: false });
  });
});

describe('identityRestorePatch', () => {
  it('puts the BEFORE values back — only identity fields, never a truncated one or an empty name', () => {
    const out = identityRestorePatch({
      fields: ['name', 'description', 'owner_profile_id', 'city'],
      before: { name: 'Pine Valley GC', description: 'x'.repeat(200) + '…', owner_profile_id: 'p', city: null },
    });
    expect(out.patch).toEqual({ name: 'Pine Valley GC', city: null });
    expect(out.skipped.sort()).toEqual(['description', 'owner_profile_id']);
    expect(identityRestorePatch({ before: { name: '  ' } }).patch).toEqual({});
    expect(identityRestorePatch(null).patch).toEqual({});
  });
});

describe('parseRecoveryQuery', () => {
  const id = '0b7c3a2e-1f4d-4c1a-9e8b-2d3c4b5a6f70';
  it('reads every way a ticket names the thing', () => {
    expect(parseRecoveryQuery('EA-1042')).toEqual({ kind: 'ticket', number: 1042 });
    expect(parseRecoveryQuery('ea1042')).toEqual({ kind: 'ticket', number: 1042 });
    expect(parseRecoveryQuery(id.toUpperCase())).toEqual({ kind: 'id', id });
    expect(parseRecoveryQuery(`https://edgeathlete.com/club/${id}`)).toEqual({ kind: 'org', side: 'club', id });
    expect(parseRecoveryQuery(`https://edge-athlete.vercel.app/app/org/league/${id}?window=members`)).toEqual({ kind: 'org', side: 'league', id });
    expect(parseRecoveryQuery(`/events/${id}`)).toEqual({ kind: 'event', id });
    expect(parseRecoveryQuery('https://edgeathlete.com/org/pine-valley/schedule')).toEqual({ kind: 'slug', slug: 'pine-valley' });
    expect(parseRecoveryQuery('edgeathlete.com/pine-valley')).toEqual({ kind: 'slug', slug: 'pine-valley' });
    expect(parseRecoveryQuery('https://www.pinevalleygolf.org/news')).toEqual({ kind: 'domain', host: 'www.pinevalleygolf.org' });
    expect(parseRecoveryQuery('Pine Valley')).toEqual({ kind: 'text', text: 'Pine Valley' });
    expect(parseRecoveryQuery('   ')).toEqual({ kind: 'empty' });
  });
});

describe('the words', () => {
  it('every authority action has words for the log', () => {
    for (const a of AUTHORITY_ACTIONS) expect(AUTHORITY_ACTION_WORDS[a], a).toBeTruthy();
  });
});

describe('the wiring', () => {
  it('recover_authority is owner-only — never in MODERATOR_INTENTS', () => {
    const src = read('src/lib/auth-server.ts');
    expect(src).toMatch(/'recover_authority'/);
    const set = /const MODERATOR_INTENTS[^=]*= new Set\(\[([^\]]*)\]\)/.exec(src);
    expect(set?.[1]).not.toMatch(/recover_authority/);
  });

  const ROUTES = ['src/app/api/admin/recovery/search/route.ts', 'src/app/api/admin/recovery/orgs/[id]/route.ts', 'src/app/api/admin/recovery/events/[id]/route.ts'];
  it.each(ROUTES)('%s gates on recover_authority', f => {
    const src = read(f);
    const handlers = src.match(/export async function (GET|POST)/g) ?? [];
    const gates = src.match(/requireModerator\(request, \{ intent: 'recover_authority' \}\)/g) ?? [];
    expect(gates.length).toBe(handlers.length);
  });
  it.each(ROUTES.slice(1))('%s rate-limits every act and opens a ticket first', f => {
    const post = read(f).split('export async function POST')[1];
    expect(post).toMatch(/enforceRateLimit\(request, 'authority-admin'/);
    expect(post).toMatch(/openRecovery\(admin, user\.id, body\.ticket, body\.note\)/);
  });

  it('every recovery write records on the ticket', () => {
    const src = read('src/lib/authority/recovery-server.ts');
    const writers = ['addOwner', 'removeOwner', 'setRole', 'revokeStaff', 'mintRecoveryLink', 'siteAction', 'eventHost', 'removeCoOrganizer', 'cancelEvent', 'makeEventPrivate'];
    for (const w of writers) {
      const body = src.split(`export async function ${w}(`)[1]?.split('\nexport ')[0] ?? '';
      expect(body, w).toMatch(/ticketAction\(admin, ctx,/);
    }
  });

  it('a held site cannot go live, publish its draft or show a preview', () => {
    const server = read('src/lib/org-sites/server.ts');
    expect(server).toMatch(/input\.action === 'publish' && \(await readSiteHold\(admin, current\.id as string\)\)/);
    expect(server.split('export async function getDraftSiteBySlug')[1]).toMatch(/if \(await readSiteHold\(admin, site\.id\)\) return null;/);
    const revisions = read('src/lib/org-sites/revisions-server.ts');
    expect(revisions.split("case 'publish': {")[1]).toMatch(/^\s*\/\/[^\n]*\n\s*if \(await readSiteHold\(admin, site\.id\)\)/);
    // The support restore publishes without pruning the history.
    expect(revisions).toMatch(/if \(prune\.length > 0 && opts\.prune !== false\)/);
    expect(read('src/lib/authority/recovery-server.ts')).toMatch(/publishDraft\(admin, fresh, ctx\.actorId, `Restored by support \$\{ctx\.ticketLabel\}`, \{ prune: false \}\)/);
  });

  it('a recovery link adds an owner beside whoever is there — the handover branch still needs an ownerless org', () => {
    const route = read('src/app/api/org-claim/[token]/route.ts');
    expect(route).toMatch(/if \(peeked\.purpose === 'recovery'\) \{\s*const recovered = await redeemRecoveryLink\(admin, token, user\);/);
    expect(route).toMatch(/if \(!peeked \|\| \(!recovery && peeked\.org\.owner_profile_id\)\)/);
  });
});
